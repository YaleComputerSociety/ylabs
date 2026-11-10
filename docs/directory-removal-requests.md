# Directory removal requests

A person y/labs lists can ask to be removed without opening a public GitHub issue (#4160).
This page covers the request channel only.
The removal itself, the record every serve, gate, index and mint path reads, is a separate step.

## Requests

A signed-in person whose CAS netid matches a live `Researcher.identifiers.netid` sees "Remove me from y/labs" on `/dashboard`.
Anyone else sees nothing there, and `/privacy` tells a listed person where to go.
Below the button, a pending request reads "We'll stop showing you within 7 days. You can ask to be listed again at any time." and an accepted one reads "Your request was accepted. You will stop appearing on y/labs within 7 days."
A declined request reads "We could not confirm this request. You can send it again." and keeps the button; once `DIRECTORY_REMOVAL_REQUEST_EMAIL` in `client/src/utils/privacyNotice.ts` names an address, it adds "or email us from the address Yale publishes for you".
If the eligibility check fails, the section stays hidden, and the server logs a fixed line with only the error name and code, never the netid or the original error.

A request is a row in `directory_removal_requests` (`server/src/models/directoryRemovalRequest.ts`).
It holds the requester's netid, the matched `Researcher` `_id`, a status of `pending`, `accepted` or `declined`, the creation time, and the decision time and deciding admin's netid.
There is no reason or note field anywhere: the user route refuses a body with any field, the admin route accepts only `status`, and the schema throws on any other path.

The collection is environment-local, listed in `NEVER_COPY_COLLECTIONS` and `PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS` in `server/src/scripts/mirrorCollectionPolicy.ts`.
A request made on Production therefore survives a promotion, and a Development refresh does not clear one.

Routes:

- `GET /api/users/directoryRemovalRequest` (signed in) answers `{ eligible, request }`, where `request` is the caller's latest `{ status, createdAt }` or `null`.
  A person who is not listed gets `{ eligible: false, request: null }` and nothing else.
- `POST /api/users/directoryRemovalRequest` (signed in, write-limited) creates a pending request.
  It answers `201` for a new request and `200` with the existing one while a request is pending or accepted, so a repeat is a no-op.
  A declined request lets the person ask again.
  A person who is not listed gets `403` with a fixed message that names nobody.
- `GET /api/admin/directory-removal-requests?status=` (admin) lists up to 200 requests, newest first, with the matched researcher's display name read at request time.
- `PUT /api/admin/directory-removal-requests/:id` (admin, audited as `directory_removal_request.decide`) takes `{ status: 'accepted' | 'declined' }` and decides a pending request; a decided one answers `409`.

The admin queue sits below the correction reports on the admin panel's "Correction Reports" tab.

## Accepting a request

Accepting only marks the request `accepted`.
It writes no removal entry and changes nothing a student sees.
The admin then records the removal on Development with `yarn --cwd server directory-removal:record`, which lands with the removal record work for #4160.
