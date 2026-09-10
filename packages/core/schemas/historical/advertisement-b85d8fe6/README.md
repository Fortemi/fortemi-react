# Frozen Advertisement Lineage

Verbatim receipt bytes from React commit
`b85d8fe6e527afdcd34694bbcf86afaa04edbf9f`, before #424 API changes:

- `knowledge-shard-v2.implementation.receipt.json`: SHA-256 `97a9711761dd6f9537739304fc7853a5880e0dbd7a8df476e0169212b5223425`
- `knowledge-shard-v2.presence.receipt.json`: SHA-256 `149ba75a545ae3abbeafbe7cb661dba982a7ffc8299dc5bca3b956114646f4c0`

These are the identities recorded in the existing advertisement's
`historicalLineage.receipts`; neither advertisement nor those identities are
rewritten. The verifier checks these frozen bytes for historical lineage and
checks the separate current receipts against current implementation source.
This preservation does not retroactively assert that b85d8fe6 was the producer
of older archives. The separately frozen 2026.7.13 released-producer receipt and
its cross-repository bindings remain unchanged. No native-restore, new release,
or widened conformance claim follows from this metadata separation.
