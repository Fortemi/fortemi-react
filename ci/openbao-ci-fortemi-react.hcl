path "kv_internal/data/ci/fortemi-react/*" {
  capabilities = ["read"]
}

path "kv_internal/metadata/ci/fortemi-react/*" {
  capabilities = ["read", "list"]
}

path "kv_internal/data/ci/shared/docs-deploy" {
  capabilities = ["read"]
}

path "kv_internal/metadata/ci/shared/docs-deploy" {
  capabilities = ["read"]
}
