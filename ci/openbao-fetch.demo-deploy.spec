# OpenBao CI fetch spec for .gitea/workflows/demo-deploy.yml.
#
# Reuses the shared static-site SSH deploy key that the docsite deploy already
# uses — the CI AppRole policy (ci/openbao-ci-fortemi-react.hcl) already grants
# read on kv_internal/.../ci/shared/docs-deploy, so no OpenBao policy change is
# needed. This assumes demo.fortemi.com is served from the same deploy host and
# user as docs.fortemi.com (the shared key's identity).
keyfile DEPLOY_SSH_KEY_FILE kv_internal/ci/shared/docs-deploy private_key
