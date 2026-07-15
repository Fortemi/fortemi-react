# Vault CI fetch spec for .gitea/workflows/demo-deploy.yml.
#
# Reuses the shared static-site SSH deploy key that the docsite deploy already
# uses.
keyfile DEPLOY_SSH_KEY_FILE ${DEPLOY_SSH_KEY_VAULT_PATH} ${DEPLOY_SSH_KEY_VAULT_FIELD}
