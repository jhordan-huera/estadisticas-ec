#!/usr/bin/env bash
# Avisa por ntfy / Telegram cuando la publicación automática empieza a fallar o vuelve a
# funcionar. Solo en los cambios de estado (comparando con la ejecución anterior), para no
# mandar un aviso cada 5 minutos mientras dure un problema.
#
#   scripts/aviso-ejecucion.sh fallo   → en un paso con if: failure()
#   scripts/aviso-ejecucion.sh ok      → en un paso con if: success()
#
# Necesita GH_TOKEN (permiso actions: read) y GITHUB_REPOSITORY / GITHUB_RUN_ID del runner.
set -euo pipefail

ESTADO="${1:?Uso: aviso-ejecucion.sh fallo|ok}"
WORKFLOW="${AVISO_WORKFLOW:-publicar.yml}"
RAMA="${GITHUB_REF_NAME:-main}"
URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
HORA=$(TZ=America/Guayaquil date +%H:%M)

# La ejecución actual sigue en curso, así que la última terminada es la anterior.
ANTERIOR=$(gh run list --repo "$GITHUB_REPOSITORY" --workflow "$WORKFLOW" --branch "$RAMA" --status completed --limit 1 --json conclusion -q '.[0].conclusion // "success"')

case "$ESTADO" in
  fallo)
    if [ "$ANTERIOR" = "failure" ]; then
      echo "La ejecución anterior también falló: ya se avisó."
      exit 0
    fi
    PASO=$(gh run view "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY" --json jobs -q '[.jobs[].steps[] | select(.conclusion == "failure") | .name] | first // ""' 2>/dev/null || true)
    DONDE="falló"
    if [ -n "$PASO" ]; then DONDE="falló en el paso «${PASO}»"; fi
    node scripts/avisar.ts --prioridad alta --url "$URL" \
      --titulo "Falló la publicación automática" \
      --mensaje "La ejecución de las ${HORA} ${DONDE}. Mientras siga fallando no se sincroniza ni se publica nada. Te aviso cuando vuelva a funcionar."
    ;;
  ok)
    if [ "$ANTERIOR" != "failure" ]; then exit 0; fi
    node scripts/avisar.ts --url "$URL" \
      --titulo "La publicación automática volvió a funcionar" \
      --mensaje "La ejecución de las ${HORA} terminó bien: se retoman la sincronización y las publicaciones."
    ;;
  *)
    echo "Estado desconocido: $ESTADO (usa fallo u ok)" >&2
    exit 2
    ;;
esac
