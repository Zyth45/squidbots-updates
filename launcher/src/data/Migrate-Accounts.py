"""Move the accounts and the characters of an older CoA repack into this one.

Drop this file and Migrate-Accounts.bat in the NEW repack folder (next to Start_All_Server.bat)
and run the .bat. It asks for the old repack folder, or takes it as an argument.

What it does, and why it does it that way:

* `acore_characters` is copied whole, including its own `updates` table. That table is what tells
  the worldserver which migrations the database has already had, so the new server applies exactly
  the ones the old database was missing on its first start.
* `acore_auth` is copied as rows only, into the tables already there. Replacing those tables would
  bring back an outdated `account` definition while the new `updates` table still claims everything
  has been applied, and the missing columns would never come back.
* `realmlist` is never touched: the new repack listens on its own ports.

Nothing is typed, read or written about passwords: both repacks already ship a MySQL option file
(`mysql/admin-client.ini`) and the script only ever passes its path to the MySQL tools.
"""
import argparse
import gzip
import hashlib
import json
import socket
import subprocess
import sys
import time
import zipfile
from pathlib import Path

AUTH_TABLES = ["account", "account_access", "account_banned", "account_muted", "realmcharacters"]
# Everything but the credentials: those stay in each repack's own option file.
DUMP_FLAGS = ["--single-transaction", "--quick", "--no-tablespaces", "--skip-lock-tables",
              "--set-gtid-purged=OFF", "--default-character-set=utf8mb4"]


class Repack:
    """One repack folder and the MySQL instance that belongs to it."""

    def __init__(self, root, label):
        self.root = Path(root).resolve()
        self.label = label
        self.ini = self.root / "mysql/admin-client.ini"
        self.my = self.root / "mysql/my.ini"
        self.bin = self.root / "mysql/bin"
        settings = self.root / "Settings/repack.json"
        for path in (self.ini, self.my, self.bin / "mysqld.exe", settings):
            if not path.exists():
                raise SystemExit(f"{label}: this is not a CoA repack folder, {path.name} is missing.\n  {self.root}")
        self.port = int(json.loads(settings.read_text(encoding="utf-8-sig"))["mysqlPort"])
        self.started = None

    # -- connection -------------------------------------------------------------------------
    def client(self, tool, *arguments):
        """A MySQL command line for this instance: its own option file, its current port."""
        return [str(self.bin / tool), f"--defaults-file={self.ini}", "--host=127.0.0.1",
                f"--port={self.port}", *arguments]

    def reachable(self):
        with socket.socket() as probe:
            probe.settimeout(0.7)
            if probe.connect_ex(("127.0.0.1", self.port)) != 0:
                return False
        # Every repack ships the same port and the same credentials: a MySQL answering on this port
        # may belong to another repack. It is this one's only if it serves this repack's data folder.
        result = subprocess.run(self.client("mysql.exe", "-N", "-B", "-e", "SELECT @@datadir"),
                                capture_output=True, text=True)
        if result.returncode != 0:
            return False
        served = Path(result.stdout.strip()).resolve() if result.stdout.strip() else None
        return served == (self.root / "mysql/data").resolve()

    def start(self):
        """Start this repack's own mysqld, on a free port, without changing any of its files."""
        if self.reachable():
            print(f"  {self.label}: MySQL already running on port {self.port}")
            return
        if not port_free(self.port):
            self.port = free_port()          # another repack owns the configured port
        (self.root / "mysql/logs").mkdir(parents=True, exist_ok=True)
        # Every path is given again here, so a repack that was renamed or moved still starts.
        self.started = subprocess.Popen(
            [str(self.bin / "mysqld.exe"), f"--defaults-file={self.my}",
             f"--basedir={self.root / 'mysql'}", f"--datadir={self.root / 'mysql/data'}",
             f"--log-error={self.root / 'mysql/logs/mysql-error.log'}",
             f"--pid-file={self.root / 'mysql/migrate.pid'}", f"--port={self.port}", "--no-monitor"],
            cwd=str(self.root / "mysql"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"  {self.label}: starting MySQL on port {self.port}...", end="", flush=True)
        for _ in range(120):
            if self.reachable():
                print(" ready")
                return
            if self.started.poll() is not None:
                raise SystemExit(f"\n{self.label}: MySQL stopped at once. See mysql/logs/mysql-error.log")
            time.sleep(1)
        raise SystemExit(f"\n{self.label}: MySQL did not answer within two minutes.")

    def stop(self):
        if not self.started:
            return
        subprocess.run(self.client("mysqladmin.exe", "shutdown"), capture_output=True)
        try:
            self.started.wait(timeout=90)
        except subprocess.TimeoutExpired:
            self.started.terminate()
        print(f"  {self.label}: MySQL stopped")

    # -- queries ----------------------------------------------------------------------------
    def query(self, sql):
        result = subprocess.run(self.client("mysql.exe", "-N", "-B", "-e", sql), capture_output=True, text=True)
        if result.returncode:
            raise SystemExit(f"{self.label}: {result.stderr.strip() or 'query failed'}")
        return [line.split("\t") for line in result.stdout.splitlines() if line]

    def count(self, sql, default=0):
        try:
            return int(self.query(sql)[0][0])
        except (IndexError, ValueError, SystemExit):
            return default

    def has_database(self, name):
        return bool(self.query(f"SHOW DATABASES LIKE '{name}'"))

    def tables(self, database):
        return {row[0] for row in self.query(f"SHOW TABLES FROM {database}")}


def port_free(port):
    with socket.socket() as probe:
        return probe.connect_ex(("127.0.0.1", port)) != 0


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def pipe(source, target, label):
    """Stream a dump straight into the other server: no multi-gigabyte file in between."""
    print(f"  {label}...", end="", flush=True)
    started = time.time()
    dump = subprocess.Popen(source, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    load = subprocess.Popen(target, stdin=dump.stdout, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    dump.stdout.close()
    load_error = load.communicate()[1].decode("utf-8", "replace").strip()
    dump_error = dump.stderr.read().decode("utf-8", "replace").strip()
    dump.wait()
    if dump.returncode or load.returncode:
        raise SystemExit(f"\n  failed: {load_error or dump_error or 'unknown error'}")
    print(f" done in {int(time.time() - started)}s")


def backup(repack, databases, destination):
    """Compressed copy of what is about to be replaced, so a bad migration is not the end."""
    print(f"  saving the current {', '.join(databases)}...", end="", flush=True)
    command = repack.client("mysqldump.exe", *DUMP_FLAGS, "--databases", *databases)
    dump = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    with gzip.open(destination, "wb", compresslevel=6) as out:
        for block in iter(lambda: dump.stdout.read(1 << 20), b""):
            out.write(block)
    error = dump.stderr.read().decode("utf-8", "replace").strip()
    if dump.wait():
        raise SystemExit(f"\n  backup failed: {error}")
    print(f" {destination.stat().st_size // (1 << 20)} MB -> {destination.name}")


def check_accounts(old, new):
    """An id or a name in both installs means silently orphaned characters. Say so before, not after."""
    old_rows = {int(row[0]): row[1].lower() for row in old.query("SELECT id, username FROM acore_auth.account")}
    new_rows = {int(row[0]): row[1].lower() for row in new.query("SELECT id, username FROM acore_auth.account")}
    new_names = {name: identifier for identifier, name in new_rows.items()}
    clashes = []
    for identifier, name in sorted(old_rows.items()):
        if identifier in new_rows and new_rows[identifier] != name:
            clashes.append(f"    id {identifier}: '{name}' here, '{new_rows[identifier]}' in the new install")
        elif name in new_names and new_names[name] != identifier:
            clashes.append(f"    '{name}': id {identifier} here, id {new_names[name]} in the new install")
    return len(old_rows), clashes



# Where the core keeps the characters migrations, and the state it records each one under.
CHARACTER_SQL = [("data/sql/archive/db_characters", "ARCHIVED"), ("data/sql/updates/db_characters", "RELEASED"),
                 ("data/sql/updates/pending_db_characters", "RELEASED"), ("data/sql/custom/db_characters", "CUSTOM")]


def sql_sources(root):
    """The .sql files of the repack's source, as {path relative to the source root: reader}, or None."""
    archive_path = root / "Source/server-source.zip"
    if archive_path.exists():
        archive = zipfile.ZipFile(archive_path)
        names = archive.namelist()
        # Jealous's zips hold everything under server-source/; a plain `git archive` has no top folder.
        prefix = "server-source/" if any(m.startswith("server-source/data/sql/") for m in names) else ""
        return {m[len(prefix):]: (lambda m=m: archive.read(m)) for m in names
                if m.startswith(prefix) and m.endswith(".sql")}
    tree = root / "Source/sql-tree"
    if tree.is_dir():
        return {p.relative_to(tree).as_posix(): p.read_bytes for p in tree.rglob("*.sql") if p.is_file()}
    return None


def upgrade_characters(new):
    """Bring the copied characters database up to the new repack's schema.

    A Jealous-Sound repack starts its worldserver with Updates.EnableDatabases = 0: the server does not
    apply migrations, the repack's own updater does. A characters database copied from an older repack
    would stay on its old schema. So the migrations the new repack's source carries and the copied
    database has not had are applied here, in the core's order, and recorded in its `updates` table the
    way the core records them -- name, hash, state -- so later updates see a database like any other.
    A file already recorded under another name (the core renames pending files when it releases them)
    is recognised by its hash and not applied twice.
    """
    # The SQL comes from Source/server-source.zip, or from Source/sql-tree (the same data/sql and modules/*/data/sql
    # tree, unpacked) when the repack ships the source as a link to its public commit instead of a zip.
    members = sql_sources(new.root)
    if members is None:
        print("  characters schema: the new repack has neither Source/server-source.zip nor Source/sql-tree, left to the server")
        return
    records = new.query("SELECT name, hash FROM acore_characters.updates")
    names = {row[0] for row in records}
    hashes = {row[1].upper() for row in records if len(row) > 1}
    plan = []
    folders = list(CHARACTER_SQL)
    # modules/<module>/data/sql/<db-characters folder>/<file>.sql
    folders += sorted({("/".join(m.split("/")[:5]), "MODULE") for m in members
                       if m.startswith("modules/") and m.split("/")[2:4] == ["data", "sql"]
                       and len(m.split("/")) == 6 and "characters" in m.split("/")[4]})
    for folder, state in folders:
        prefix = folder + "/"
        for member in sorted(m for m in members if m.startswith(prefix) and "/" not in m[len(prefix):]):
            data = members[member]()
            name = member.rsplit("/", 1)[1]
            if name in names:
                continue
            if not data:
                # sql-tree keeps archived migrations as empty placeholders: a database that never had one
                # cannot be brought up to date from here.
                print(f"  characters schema: {name} is only a placeholder in this repack, skipped")
                continue
            digest = hashlib.sha1(data.replace(b"\r\n", b"\n")).hexdigest().upper()
            if digest in hashes:
                new.query(f"UPDATE acore_characters.updates SET name = '{name}' WHERE hash = '{digest}' LIMIT 1")
                continue
            plan.append((name, digest, state, data))
    if not plan:
        print("  characters schema: already up to date")
        return
    print(f"  characters schema: {len(plan)} migration(s) the old database had not had")
    for name, digest, state, data in plan:
        result = subprocess.run(new.client("mysql.exe", "--default-character-set=utf8mb4", "acore_characters"),
                                input=data, capture_output=True)
        if result.returncode:
            raise SystemExit(f"  {name} failed: {result.stderr.decode('utf-8', 'replace').strip()}\n"
                             "  The backup of the new install is untouched; nothing else was changed after it.")
        new.query("INSERT INTO acore_characters.updates (name, hash, state, speed) "
                  f"VALUES ('{name}', '{digest}', '{state}', 0)")
        print(f"    {name}")


def main():
    parser = argparse.ArgumentParser(description="Bring accounts and characters over from an older CoA repack.")
    parser.add_argument("old", nargs="?", help="the old repack folder (the one with Start_All_Server.bat)")
    parser.add_argument("--to", default=str(Path(__file__).resolve().parent),
                        help="the new repack folder (default: the folder this script is in)")
    parser.add_argument("--no-bots", action="store_true",
                        help="leave acore_playerbots behind (by default it comes with the characters)")
    parser.add_argument("--bots-only", action="store_true",
                        help="copy acore_playerbots alone and leave accounts and characters as they are")
    parser.add_argument("--force", action="store_true", help="replace the new install's own characters")
    parser.add_argument("--yes", action="store_true", help="do not ask for confirmation")
    parser.add_argument("--check", action="store_true",
                        help="look at both installs and report, without changing anything")
    arguments = parser.parse_args()

    source = arguments.old or input("Old repack folder (you can drag and drop it here): ").strip().strip('"')
    if not source:
        raise SystemExit("Nothing to do: no old repack folder given.")

    old = Repack(source, "old")
    new = Repack(arguments.to, "new")
    if old.root == new.root:
        raise SystemExit("The old and the new folder are the same one.")

    print(f"\n  from : {old.root}\n  to   : {new.root}\n")
    # A port already taken (often by the other repack's own MySQL, same port) is not a problem:
    # start() then runs this repack's MySQL on a free port of its own.

    try:
        old.start()
        new.start()

        for repack in (old, new):
            for database in ("acore_auth", "acore_characters"):
                if not repack.has_database(database):
                    raise SystemExit(f"{repack.label}: {database} is missing. Start that repack once, then retry.")

        old_characters = old.count("SELECT COUNT(*) FROM acore_characters.characters")
        new_characters = new.count("SELECT COUNT(*) FROM acore_characters.characters")
        accounts, clashes = check_accounts(old, new)
        print(f"\n  old install: {accounts} accounts, {old_characters} characters")
        print(f"  new install: {new.count('SELECT COUNT(*) FROM acore_auth.account')} accounts, "
              f"{new_characters} characters\n")

        if clashes:
            print("  These accounts exist in both installs and cannot be merged safely:")
            print("\n".join(clashes[:20]))
            raise SystemExit("\n  Delete them in the new install (or start from a fresh copy) and run this again.")
        if arguments.check:
            bots = old.count("SELECT COUNT(*) FROM acore_characters.characters c JOIN acore_auth.account a"
                             " ON a.id = c.account WHERE a.username LIKE 'rndbot%'")
            print(f"  Of the old characters, {bots} belong to bot accounts and {old_characters - bots} do not.")
            print(f"  acore_playerbots in the old install: {'yes' if old.has_database('acore_playerbots') else 'no'}")
            print("\n  Nothing was changed (--check). Drop it to run the migration.")
            return
        if new_characters and not arguments.force and not arguments.bots_only:
            raise SystemExit(f"  The new install already has {new_characters} characters and they would be "
                             "replaced.\n  Use --force if that is what you want.")
        if not arguments.yes:
            print("  Only the bot database will be replaced." if arguments.bots_only else
                  "  The new install's characters will be replaced by the old ones, accounts added to them.")
            if input("  Type yes to go on: ").strip().lower() not in ("yes", "y", "oui", "o"):
                raise SystemExit("  Nothing was changed.")

        stamp = time.strftime("%Y%m%d-%H%M")
        saved = new.root / f"Migration-backup-{stamp}.sql.gz"
        bots = old.has_database("acore_playerbots") and not arguments.no_bots
        if arguments.bots_only and not bots:
            raise SystemExit("  The old install has no acore_playerbots to copy.")
        replaced = [] if arguments.bots_only else ["acore_auth", "acore_characters"]
        if bots and new.has_database("acore_playerbots"):
            replaced.append("acore_playerbots")
        print("\n  Backup")
        if replaced:
            backup(new, replaced, saved)
        else:
            saved = None
            print("  nothing to save: the new install has none of the databases being replaced")

        print("\n  Transfer")
        if arguments.bots_only:
            pipe(old.client("mysqldump.exe", *DUMP_FLAGS, "--databases", "acore_playerbots"),
                 new.client("mysql.exe"), "bot data (acore_playerbots)")
            print("\n  Done. Accounts and characters were left alone."
                  + (f" Backup: {saved.name}" if saved else ""))
            return

        # The whole characters database, its `updates` table included: that table says which
        # migrations it has had, and upgrade_characters() applies the rest.
        pipe(old.client("mysqldump.exe", *DUMP_FLAGS, "--databases", "acore_characters"),
             new.client("mysql.exe"), "characters")

        upgrade_characters(new)

        # Rows only, into the new install's own (already migrated) auth tables.
        shared = sorted(set(AUTH_TABLES) & old.tables("acore_auth") & new.tables("acore_auth"),
                        key=AUTH_TABLES.index)
        pipe(old.client("mysqldump.exe", *DUMP_FLAGS, "--no-create-info", "--complete-insert",
                        "--insert-ignore", "--skip-triggers", "acore_auth", *shared),
             new.client("mysql.exe", "acore_auth"), f"accounts ({', '.join(shared)})")

        # The bot characters travel inside acore_characters, but the module keeps what it knows about
        # them in acore_playerbots. Leave that behind and the two no longer describe the same bots:
        # the module stops recognising them. It comes over unless the user says otherwise.
        if bots:
            pipe(old.client("mysqldump.exe", *DUMP_FLAGS, "--databases", "acore_playerbots"),
                 new.client("mysql.exe"), "bot data (acore_playerbots)")
        elif old.has_database("acore_playerbots"):
            print("  bot data: skipped (--no-bots). If the bots stop working, run again without it.")

        print("\n  Result")
        print(f"    accounts   : {new.count('SELECT COUNT(*) FROM acore_auth.account')}")
        print(f"    characters : {new.count('SELECT COUNT(*) FROM acore_characters.characters')}")
        print(f"    backup     : {saved.name if saved else 'none'}")
        print("\n  Start the server as usual. The first start is slower than normal: that is the")
        print("  character database being brought up to date. Logins and passwords are unchanged.")
    finally:
        for repack in (new, old):
            repack.stop()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n  Interrupted.")
        sys.exit(1)
