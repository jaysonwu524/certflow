package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	_ "github.com/jackc/pgx/v5/stdlib"
)

const migrationAdvisoryLockID int64 = 314163127441

// migrationsFS bundles schema migrations into the backend image. This keeps
// deployments artifact-only: no source checkout or manual SQL is required.
//
//go:embed migrations/*.up.sql
var migrationsFS embed.FS

// Migrate applies pending database migrations through golang-migrate. A
// PostgreSQL advisory lock ensures only one CertFlow instance migrates at a
// time when an operator briefly runs multiple backend containers.
func (s *Store) Migrate(ctx context.Context, databaseURL string) error {
	lockConnection, err := s.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire migration lock connection: %w", err)
	}
	defer lockConnection.Release()

	if _, err := lockConnection.Exec(ctx, `SELECT pg_advisory_lock($1)`, migrationAdvisoryLockID); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	defer lockConnection.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, migrationAdvisoryLockID)

	if err := s.normalizeLegacyMigrationHistory(ctx); err != nil {
		return err
	}

	database, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return fmt.Errorf("open migration database: %w", err)
	}
	if err := database.PingContext(ctx); err != nil {
		database.Close()
		return fmt.Errorf("ping migration database: %w", err)
	}

	databaseDriver, err := postgres.WithInstance(database, &postgres.Config{})
	if err != nil {
		database.Close()
		return fmt.Errorf("create PostgreSQL migration driver: %w", err)
	}
	sourceDriver, err := iofs.New(migrationsFS, "migrations")
	if err != nil {
		databaseDriver.Close()
		return fmt.Errorf("load embedded migrations: %w", err)
	}
	migration, err := migrate.NewWithInstance("iofs", sourceDriver, "postgres", databaseDriver)
	if err != nil {
		sourceDriver.Close()
		databaseDriver.Close()
		return fmt.Errorf("initialize migration runner: %w", err)
	}
	defer migration.Close()

	if err := migration.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("apply database migrations: %w", err)
	}
	return nil
}

// normalizeLegacyMigrationHistory upgrades the migration ledger created by
// CertFlow versions before golang-migrate. The previous ledger stored one row
// per applied migration, whereas golang-migrate stores only the current
// version and a dirty flag. No business tables or data are modified.
func (s *Store) normalizeLegacyMigrationHistory(ctx context.Context) error {
	var tableExists bool
	if err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.tables
			WHERE table_schema = current_schema() AND table_name = 'schema_migrations'
		)
	`).Scan(&tableExists); err != nil {
		return fmt.Errorf("check migration ledger: %w", err)
	}
	if !tableExists {
		return nil
	}

	var dirtyColumnExists bool
	if err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.columns
			WHERE table_schema = current_schema()
				AND table_name = 'schema_migrations'
				AND column_name = 'dirty'
		)
	`).Scan(&dirtyColumnExists); err != nil {
		return fmt.Errorf("inspect migration ledger: %w", err)
	}
	if dirtyColumnExists {
		return nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin legacy migration ledger upgrade: %w", err)
	}
	defer tx.Rollback(ctx)

	var currentVersion int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&currentVersion); err != nil {
		return fmt.Errorf("read legacy migration version: %w", err)
	}
	if _, err := tx.Exec(ctx, `ALTER TABLE schema_migrations ADD COLUMN dirty boolean NOT NULL DEFAULT false`); err != nil {
		return fmt.Errorf("add migration dirty flag: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM schema_migrations WHERE version <> $1`, currentVersion); err != nil {
		return fmt.Errorf("compact migration ledger: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit legacy migration ledger upgrade: %w", err)
	}
	return nil
}
