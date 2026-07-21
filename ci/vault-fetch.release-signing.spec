# OpenBao release-signing material for tools/release/cut-tag.sh.
#
# Values are written to mode-600 files. The wrapper imports the key into an
# isolated temporary GNUPGHOME and removes the entire directory on exit.
keyfile GPG_SIGNING_KEY_FILE kv_internal/gpg/fortemi-react-release-signing-key armored_private_key
keyfile GPG_PASSPHRASE_FILE kv_internal/gpg/fortemi-react-release-signing-key passphrase
