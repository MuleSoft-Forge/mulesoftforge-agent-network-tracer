# Minimal persistent Redis for Fly.io. Password comes from the REDIS_PASSWORD
# secret at runtime; AOF persistence writes to the mounted /data volume.
FROM redis:7-alpine

# Shell-form CMD so $REDIS_PASSWORD expands at container start.
CMD sh -c 'exec redis-server --appendonly yes --dir /data --requirepass "$REDIS_PASSWORD"'
