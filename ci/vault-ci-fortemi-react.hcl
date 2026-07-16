path "${FORTEMI_REACT_VAULT_DATA_PREFIX}/*" {
  capabilities = ["read"]
}

path "${FORTEMI_REACT_VAULT_METADATA_PREFIX}/*" {
  capabilities = ["read", "list"]
}

path "${DOCS_DEPLOY_KEY_VAULT_DATA_PATH}" {
  capabilities = ["read"]
}

path "${DOCS_DEPLOY_KEY_VAULT_METADATA_PATH}" {
  capabilities = ["read"]
}
