#!/bin/sh
set -eu
case "${1:-start}" in
  start) node scripts/init-container.js; set -- server/src/backend.js --http ;;
  doctor) shift; set -- scripts/doctor.js "$@" ;;
  import) shift; set -- scripts/import-memory-package.js "$@" ;;
  example) shift; set -- examples/host/run.js "$@" ;;
  example-http) shift; set -- examples/http/run.js "$@" ;;
  token)
    case "${2:-runtime}" in
      runtime) set -- -p process.env.MOSS_RUNTIME_TOKEN ;;
      admin) set -- -p process.env.MOSS_ADMIN_TOKEN ;;
      *) echo "Usage: moss token [runtime|admin]" >&2; exit 1 ;;
    esac ;;
esac
exec node --env-file=data/config/tokens.env "$@"
