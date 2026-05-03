package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v4"
)

type Tanfig struct {
	Extensions struct {
		Tom struct {
			DbURI string `json:"dbURI"`
		} `json:"tom"`
	} `json:"extensions"`
}

func main() {
	fmt.Println("⏣ tom Native: Starting migration...")
	cwd, _ := os.Getwd()


	// 1. Try Environment Variable (from CLI)
	dbURI := os.Getenv("DB_URI")
	
	if dbURI == "" {
		// 2. Read tanfig.json
		tanfigPath := filepath.Join(cwd, "tanfig.json")

		data, err := ioutil.ReadFile(tanfigPath)
		if err == nil {
			var config Tanfig
			if err := json.Unmarshal(data, &config); err == nil {
				dbURI = config.Extensions.Tom.DbURI
			}
		}
	}

	if dbURI == "" {
		log.Fatal("Error: No database URI found. Provide it via DB_URI env or tanfig.json")
	}


	// 2. Connect to Database
	conn, err := pgx.Connect(context.Background(), dbURI)
	if err != nil {
		log.Fatalf("Unable to connect to database: %v", err)
	}
	defer conn.Close(context.Background())

	// 3. Find and Execute Migrations
	migrationsDir := filepath.Join(cwd, ".titan", "migrations")
	files, err := ioutil.ReadDir(migrationsDir)
	if err != nil {
		log.Fatalf("Failed to read migrations directory: %v", err)
	}

	for _, file := range files {
		if filepath.Ext(file.Name()) == ".sql" {
			fmt.Printf("Applying migration: %s\n", file.Name())
			sql, err := ioutil.ReadFile(filepath.Join(migrationsDir, file.Name()))
			if err != nil {
				log.Fatalf("Failed to read migration file %s: %v", file.Name(), err)
			}

			_, err = conn.Exec(context.Background(), string(sql))
			if err != nil {
				log.Fatalf("Failed to execute migration %s: %v", file.Name(), err)
			}
		}
	}

	fmt.Println("✓ tom Native: Migration complete!")
}
