# A room-booking takeover, with source evidence

This is a reviewed walkthrough of a real Emara audit of [julia-/room-booking-system](https://github.com/julia-/room-booking-system/tree/9b40ef983d38a8b5862c629e860693cfd98108f7), a public Express and React application. It is an illustrative takeover, not a client engagement or an endorsement by the repository's authors.

**Start here:** Emara identifies the booking endpoints and their source locations. A developer can use those locations to investigate the implementation. Its documentation matching and unused-import checks also make mistakes on this repository, shown below.

This page adds human source review to the generated output. The explanations and additional source links below are editorial annotations, not prose automatically produced by Emara. [Read the unchanged generated report](audit-report.md) and [run provenance](provenance.md).

## Where does booking creation live?

Emara identifies `PUT /rooms/:id` at `api/routes/rooms.js:46`. Reading [the handler](https://github.com/julia-/room-booking-system/blob/9b40ef983d38a8b5862c629e860693cfd98108f7/api/routes/rooms.js#L45-L151) confirms code for both single and recurring bookings. The single-booking branch updates the room's bookings; the recurring branch constructs a series and persists it.

For a takeover, this gives you a concrete starting point for investigating booking changes instead of searching the whole repository. It does not prove booking behavior is correct at runtime. Emara labels this endpoint "implemented but undocumented"; this walkthrough verifies the endpoint and implementation location, not that documentation verdict.

## Where does booking deletion live?

Emara identifies `DELETE /rooms/:id/:bookingId` at `api/routes/rooms.js:154`. The [handler](https://github.com/julia-/room-booking-system/blob/9b40ef983d38a8b5862c629e860693cfd98108f7/api/routes/rooms.js#L153-L168) removes a booking with MongoDB's `$pull` operation and includes `requireJWT` middleware.

Additional human inspection finds the corresponding [frontend request](https://github.com/julia-/room-booking-system/blob/9b40ef983d38a8b5862c629e860693cfd98108f7/web/src/api/booking.js#L61-L65). This frontend/backend connection was checked manually; it is not a claim that Emara automatically proved the entire cross-network flow.

## One cleanup candidate worth investigating

The report flags the named export [`unregister`](https://github.com/julia-/room-booking-system/blob/9b40ef983d38a8b5862c629e860693cfd98108f7/web/src/registerServiceWorker.js#L102-L108). A search of tracked frontend source found no import or call to this named export. The [application entrypoint](https://github.com/julia-/room-booking-system/blob/9b40ef983d38a8b5862c629e860693cfd98108f7/web/src/index.js#L1-L9) imports and calls the separate default registration function.

The calls to `registration.unregister()` in the same file are browser API calls, not calls to the exported helper. This supports investigating the helper as unused within this checkout. No deletion, build, or runtime validation was performed; it is not certified safe to remove.

## Where the report gets it wrong

**Authentication:** the raw report labels an authentication requirement "documented but not implemented." That is a documentation-matching failure, not a verified absence of authentication. [JWT authentication middleware exists](https://github.com/julia-/room-booking-system/blob/9b40ef983d38a8b5862c629e860693cfd98108f7/api/middleware/auth.js#L51-L79), and the room routes use it. This source review does not establish that all access-control requirements are satisfied or that the application is secure.

**React imports:** the raw report flags React imports as lexically unused, including the import in `web/src/index.js`. This project uses [React 16 and react-scripts 1.0.17](https://github.com/julia-/room-booking-system/blob/9b40ef983d38a8b5862c629e860693cfd98108f7/web/package.json#L12-L18); its classic JSX transform depends on React even without an explicit `React.*` expression. Do not remove those imports based on this report.

**Summary and timing:** the generated report records 22 feature entries and 36 candidates. Those are engine output counts, not 22 verified business capabilities or 36 safe deletions. Its "Limitations: None" section fails to represent the problems above. Its zero-millisecond timing fields are not a measured runtime and should not be used as a speed claim.

## What this sample establishes

The current CLI can provide useful route-to-source starting points and review candidates, without model requests. It still needs human review, especially for documentation verdicts and legacy framework behavior. This is an early tool for investigation, not a replacement for tests, a security audit, or a fixed-price estimate.

Would these source locations help you get oriented in a takeover, or is there a different question you would need the report to answer first?
