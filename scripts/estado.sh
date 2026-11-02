#!/usr/bin/env bash
# Gestiona la rama "estado", donde viven la base de datos SQLite y las imágenes generadas.
# Las imágenes se sirven desde raw.githubusercontent.com para que la API de Instagram
# pueda descargarlas, por eso se suben ANTES de publicar.
#
#   scripts/estado.sh preparar        → deja la rama en ./estado (o la crea vacía)
#   scripts/estado.sh guardar "msg"   → sube el estado como un único commit (sin historial)
#
# La rama se reescribe en cada guardado para que el repositorio no crezca con imágenes viejas.
set -euo pipefail

BRANCH="${ESTADO_BRANCH:-estado}"
DIR="${ESTADO_DIR:-estado}"

case "${1:-}" in
  preparar)
    if [ -d "$DIR" ]; then git worktree remove --force "$DIR" 2>/dev/null || rm -rf "$DIR"; fi
    if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
      git fetch --quiet --depth=1 origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
      git worktree add --quiet --detach "$DIR" "origin/$BRANCH"
      echo "Rama $BRANCH preparada en $DIR"
    else
      git worktree add --quiet --detach "$DIR"
      (cd "$DIR" && git rm -rq --cached . && find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +)
      echo "La rama $BRANCH no existe: se creará en el primer guardado"
    fi
    mkdir -p "$DIR/media"
    ;;

  guardar)
    MSG="${2:-estado $(date -u +'%Y-%m-%d %H:%M') UTC}"
    cd "$DIR"
    cat > README.md <<'TXT'
# Rama de estado (generada automáticamente)

Contiene la base de datos SQLite (`marcador.sqlite`) y las imágenes generadas (`media/`).
La escribe el workflow "Publicar" y se reescribe en cada ejecución: no la edites a mano.
TXT
    git add -A
    NEW_TREE=$(git write-tree)
    OLD_TREE=$(git rev-parse --quiet --verify "refs/remotes/origin/$BRANCH^{tree}" 2>/dev/null || echo "")
    if [ "$NEW_TREE" = "$OLD_TREE" ]; then
      echo "Sin cambios en el estado"
      exit 0
    fi
    COMMIT=$(git -c user.name="estadisticas-ec-bot" -c user.email="actions@users.noreply.github.com" commit-tree "$NEW_TREE" -m "$MSG")
    git push --quiet --force origin "$COMMIT:refs/heads/$BRANCH"
    git update-ref "refs/remotes/origin/$BRANCH" "$COMMIT"
    echo "Estado guardado en $BRANCH ($MSG)"
    ;;

  *)
    echo "Uso: $0 preparar | guardar \"mensaje\"" >&2
    exit 2
    ;;
esac
