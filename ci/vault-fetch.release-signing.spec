# OpenBao release-signing material for tools/release/cut-tag.sh.
#
# Values are written to mode-600 files. The wrapper imports the key into an
# isolated temporary GNUPGHOME and removes the entire directory on exit.
keyfile GPG_SIGNING_KEY_FILE ${RELEASE_SIGNING_KEY_VAULT_PATH} ${RELEASE_SIGNING_KEY_VAULT_FIELD}
keyfile GPG_PASSPHRASE_FILE ${RELEASE_SIGNING_PASSPHRASE_VAULT_PATH} ${RELEASE_SIGNING_PASSPHRASE_VAULT_FIELD}
