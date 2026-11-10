# Runs inside the db-bootstrap task as `sh -c "<this file>"`.
# Connection settings arrive as PG* environment variables; the master user and
# password are injected from the RDS-managed secret.
#
# Idempotent: safe to run again, and running it again after the application
# password changes re-syncs the role to the new password.
set -eu

psql -v ON_ERROR_STOP=1 \
  -v app_user="$APP_DB_USER" \
  -v app_password="$APP_DB_PASSWORD" \
  -v db_name="$PGDATABASE" <<'SQL'
-- PostGIS needs rds_superuser; the application role only finds it already present.
CREATE EXTENSION IF NOT EXISTS postgis;

SELECT format('CREATE ROLE %I LOGIN', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') \gexec

ALTER ROLE :"app_user" WITH LOGIN PASSWORD :'app_password';
GRANT ALL PRIVILEGES ON DATABASE :"db_name" TO :"app_user";
GRANT ALL ON SCHEMA public TO :"app_user";
SQL

echo "db-bootstrap: role and extensions are in place"
