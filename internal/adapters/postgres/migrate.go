package postgres

import (
	"context"
	"fmt"

	"github.com/claudioed/polaris/migrations"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

func Migrate(ctx context.Context, databaseURL string) error {
	config, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return err
	}
	db := stdlib.OpenDB(*config)
	defer db.Close()
	if err = db.PingContext(ctx); err != nil {
		return err
	}
	goose.SetBaseFS(migrations.Files)
	if err = goose.SetDialect("postgres"); err != nil {
		return err
	}
	if err = goose.UpContext(ctx, db, "."); err != nil {
		return fmt.Errorf("apply database migrations: %w", err)
	}
	return nil
}
