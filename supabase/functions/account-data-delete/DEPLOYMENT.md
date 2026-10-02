# account-data-delete

Deletes one archived account's journal data by exact source + account + server.

- verify_jwt: false
- runtime authorization is implemented in the checked-in source with `requireApprovedUser`.
- database mutation is delegated to the service-role-only `account_delete_data_service` RPC.
- deletion is refused while the direct broker connection is active or a manual connector heartbeat is fresh.
