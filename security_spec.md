# Firestore Security Specification (`security_spec.md`)

## 1. Data Invariants

1. **Default-Deny Baseline**: Every path not explicitly granted in `firestore.rules` denies all reads and writes (`allow read, write: if false;`).
2. **PII Isolation (`/users/{userId}`)**: Customer profile records containing `email` and `phone` are strictly readable (`get`) and writable only by the owning verified Firebase Auth user (`request.auth.uid == userId && request.auth.token.email_verified == true`) or a verified administrator. Blanket `list` queries over `/users` are permanently denied.
3. **Zero Client-Assigned Roles**: Neither `/users/{userId}` nor client signup payloads permit `role`, `roleCode`, or `isAdmin` fields (`hasOnly(...)`). Admin privileges require an explicit verified entry in `/admins/{adminUid}` or verified bootstrapped owner identity (`sanjuladubey05@gmail.com` with `email_verified == true`).
4. **Master Gate Integrity (`/games/{gameId}/packages/{packageId}`)**: A package cannot be created or updated unless its parent `/games/{gameId}` document exists (`exists(...)`) and its `gameId` matches the path parameter.
5. **Order Ownership, State Integrity & Terminal Locking (`/orders/{orderId}`)**:
   - Buyers can only create orders bound to their own `request.auth.uid`, pointing to an existing user profile and existing catalog game, initialized strictly in `status == 'pending'` and `paymentStatus == 'unpaid'`, using server `request.time`.
   - List queries over `/orders` strictly evaluate `resource.data.userId == request.auth.uid` (no `get()`/`exists()` inside `allow list`).
   - Terminal order states (`completed`, `refunded`, `cancelled`) cannot be modified by non-admins.
   - Non-admin updates are restricted solely to cancelling a `pending` order (`affectedKeys().hasOnly(['status', 'updatedAt'])`).
6. **Path & Field Resource Bounds**: All path IDs (`userId`, `adminUid`, `gameId`, `packageId`, `orderId`) must match `^[a-zA-Z0-9_-]+$` within `1..128` characters, and every string field enforces explicit `.size()` limits.

## 2. Dirty Dozen Attack Payloads

1. **Identity Spoof on Order Creation**: User A sets `userId: "user-B"` on `/orders/ord-1` (`PERMISSION_DENIED`).
2. **Shadow Admin Privilege Injection**: User A creates `/users/{uid}` adding `{ isAdmin: true, roleCode: "owner" }` (`PERMISSION_DENIED`).
3. **Unverified Email Token Write**: Account with `email_verified: false` attempts to write `/users/{uid}` or claim admin (`PERMISSION_DENIED`).
4. **Cross-User PII Read**: User B executes `get` on `/users/{userA}` (`PERMISSION_DENIED`).
5. **Users Collection Enumeration**: Signed-in user executes `list` on `/users` (`PERMISSION_DENIED`).
6. **Orphaned Package Injection**: Admin/attacker creates `/games/missing-game/packages/pkg-1` when `/games/missing-game` does not exist (`PERMISSION_DENIED`).
7. **Paid Status Bypass on Order Create**: Buyer creates `/orders/ord-2` with `status: "completed"` and `paymentStatus: "paid"` (`PERMISSION_DENIED`).
8. **Terminal Order Tampering**: Buyer mutates `/orders/ord-3` after status reached `"completed"` (`PERMISSION_DENIED`).
9. **Price/Total Tampering Update**: Buyer updates `totalAmountInr` via `affectedKeys` during pending order cancel (`PERMISSION_DENIED`).
10. **Forged Timestamps**: Client sends past or future `createdAt`/`updatedAt` timestamp instead of `request.time` (`PERMISSION_DENIED`).
11. **Oversized/Poisoned Document ID**: Attacker writes `/orders/evil$bad..path` or a 1,500-character ID (`PERMISSION_DENIED`).
12. **Cross-User Order Scraping**: User B queries `orders` collection without scoping `userId == request.auth.uid` (`PERMISSION_DENIED`).
