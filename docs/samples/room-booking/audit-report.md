# Functionality Audit Report

Repository commit: `9b40ef983d38a8b5862c629e860693cfd98108f7`

## Takeover Summary

The audit records 10 implemented and documented features, 4 implemented but undocumented features, 7 partially implemented features, and 1 documented but not implemented feature. It also identifies 36 dead-code candidates, with 36 ready for delete validation.

### Dead code ready to validate

- `web/src/App.js:12` — `Button`
- `web/src/App.js:14` — `Footer`
- `web/src/App.js:32` — `floorParams`
- `web/src/App.js:33` — `initialRoom`
- `web/src/api/rooms.js:1` — `React`

Use this evidence for codebase takeover, fixed-price quoting, billed dead-code cleanup, and a handoff deliverable.

## Summary

| Result | Count |
| --- | ---: |
| Total features | 22 |
| Implemented and documented | 10 |
| Implemented but undocumented | 4 |
| Partially implemented | 7 |
| Documented but not implemented | 1 |
| Ambiguous | 0 |
| Dead-code candidates | 36 |
| Ready for delete validation | 36 |
| Validated safe to delete | 0 |

## Features

### Implemented and documented (10)

- Api / Models / Api / Routes (`module-api-models-api-routes`, infrastructure, high confidence)
  - Entrypoints: None
- GET /rooms (`get-rooms`, functional, high confidence)
  - Entrypoints: `entrypoint:http:api/routes/rooms.js:9:GET /rooms`
- POST /rooms (`post-rooms`, functional, high confidence)
  - Entrypoints: `entrypoint:http:api/routes/rooms.js:19:POST /rooms`
- Web / Src (`module-web-src`, functional, high confidence)
  - Entrypoints: None
- Web / Src / Auth (`module-web-src-auth`, non_functional, high confidence)
  - Entrypoints: None
- Web / Src / Booking Element (`module-web-src-booking-element`, functional, high confidence)
  - Entrypoints: None
- Web / Src / Booking Form Table (`module-web-src-booking-form-table`, functional, high confidence)
  - Entrypoints: None
- npm script api:drop (`npm-script-api-drop`, functional, high confidence)
  - Entrypoints: `entrypoint:cli:api/models/drop.js:1:npm script api:drop`
- npm script api:seed (`npm-script-api-seed`, functional, high confidence)
  - Entrypoints: `entrypoint:cli:api/models/seed.js:1:npm script api:seed`
- npm script api:start (`npm-script-api-start`, functional, high confidence)
  - Entrypoints: `entrypoint:cli:api/server.js:1:npm script api:start`

### Implemented but undocumented (4)

- DELETE /rooms/:id/:bookingId (`delete-rooms-id-bookingid`, functional, high confidence)
  - Entrypoints: `entrypoint:http:api/routes/rooms.js:154:DELETE /rooms/:id/:bookingId`
- POST /auth (`post-auth`, non_functional, high confidence)
  - Entrypoints: `entrypoint:http:api/routes/auth.js:14:POST /auth`
- POST /auth/sign-up (`post-auth-sign-up`, non_functional, high confidence)
  - Entrypoints: `entrypoint:http:api/routes/auth.js:11:POST /auth/sign-up`
- PUT /rooms/:id (`put-rooms-id`, functional, high confidence)
  - Entrypoints: `entrypoint:http:api/routes/rooms.js:46:PUT /rooms/:id`

### Partially implemented (7)

- A web-based application that allows the client (including its administrative staff, teachers and students) to login from anywhere to easily, accurately and quickly make room bookings. (`a-web-based-application-that-allows-the-client-including-its-adm`, functional, high confidence)
  - Entrypoints: None
  - Gaps: Documented enumeration is only partially implemented; no implementation graph evidence was found for: teachers and students) to login from anywhere to easily, accurately.
- In order to clearly see who has made a booking, and on behalf of which business unit, as an Admin User, I want to require application users to create a profile with this information. (`in-order-to-clearly-see-who-has-made-a-booking-and-on-behalf-of`, functional, high confidence)
  - Entrypoints: None
  - Gaps: Documented enumeration is only partially implemented; no implementation graph evidence was found for: and on behalf of which business unit.
- In order to ensure my booking was successfully created, as a Business Unit Representative, I want to be directed to a confirmation page. (`in-order-to-ensure-my-booking-was-successfully-created-as-a-busi`, functional, high confidence)
  - Entrypoints: None
  - Gaps: Documented enumeration is only partially implemented; no implementation graph evidence was found for: as a Business Unit Representative, I want to be directed to a confirmation page.
- In order to ensure only approved staff members from my business unit can access the application, as a Business Unit Representative, I want to be able to create and/or approve basic user accounts. (`in-order-to-ensure-only-approved-staff-members-from-my-business`, non_functional, high confidence)
  - Entrypoints: None
  - Gaps: Documented enumeration is only partially implemented; no implementation graph evidence was found for: In order to ensure only approved staff members from my business unit can access the application, as a Business Unit Representative.
- In order to ensure that room allocation is flexible and amend errors in bookings, as a Business Unit Representative, I want to be able to edit bookings, delete bookings (i.e. not just my own) and/or reassign bookings to different rooms. (`in-order-to-ensure-that-room-allocation-is-flexible-and-amend-er`, functional, high confidence)
  - Entrypoints: None
  - Gaps: Documented enumeration is only partially implemented; no implementation graph evidence was found for: as a Business Unit Representative, I want to be able to edit bookings.
- The client has forty rooms over two floors available for use by staff, teachers and students. The booking of these rooms is currently managed using a basic spreadsheet system. This method is inflexible, cumbersome and does not allow for a high degree of specificity with respect to booking times. It also does not give the client a clear understanding of how their rooms are used and how the use of these resources can be optimised. (`the-client-has-forty-rooms-over-two-floors-available-for-use-by`, functional, high confidence)
  - Entrypoints: None
  - Gaps: Documented enumeration is only partially implemented; no implementation graph evidence was found for: cumbersome, how the use of these resources can be optimised.
- [x] Backend - Node.js [x] Frontend - ReactJS [x] MongoDB and Mongoose [x] Authentication (Google OAuth) [x] Authorisation [x] Filtering capability [x] User interface [x] Deploye back-end, front-end and host database [x] README (`x-backend-node-js-x-frontend-reactjs-x-mongodb-and-mongoose-x-au`, functional, high confidence)
  - Entrypoints: None
  - Gaps: Documented enumeration is only partially implemented; no implementation graph evidence was found for: front-end, host database [x] README.

### Documented but not implemented (1)

- In order to restrict access to the application, as the Product Owner, I want to enforce authentication. (`in-order-to-restrict-access-to-the-application-as-the-product-ow`, non_functional, high confidence)
  - Entrypoints: None
  - Gaps: No implementation graph node matches the claim key terms (acces, application, authentication, enforce, order, owner, product, restrict, want); dependency manifests are not implementation evidence.

### Ambiguous (0)

None.

## Dead-Code Candidates

- `web/src/App.js::Button` — Import binding "Button" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/App.js::Footer` — Import binding "Footer" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/App.js::floorParams` — Import binding "floorParams" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/App.js::initialRoom` — Import binding "initialRoom" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/api/rooms.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/api/rooms.js::moment` — Import binding "moment" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/BookingElement.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/BookingForm.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/BookingFormTable.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/BookingModal.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/Button.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/Calendar.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/ColumnCell.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/FilterElement.js::Button` — Import binding "Button" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/FilterElement.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/FilterElement.js::endTimeSelectOptions` — Import binding "endTimeSelectOptions" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/FilterElement.js::formatTime` — Import binding "formatTime" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/FilterElement.js::moment` — Import binding "moment" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/FilterElement.js::startTimeSelectOptions` — Import binding "startTimeSelectOptions" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/Footer.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/Key.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/MyBookings.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/NavBar.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/RoomRow.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/RoomsList.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/SignInForm.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/components/SignUpForm.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/helpers/bookingForm.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/helpers/filters.js::formatTime` — Import binding "formatTime" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/helpers/filters.js::moment` — Import binding "moment" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/helpers/filters.js::timeSelectOptions` — Import binding "timeSelectOptions" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/helpers/rooms.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/helpers/sorter.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/index.js::React` — Import binding "React" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/index.js::queryString` — Import binding "queryString" has no lexical use outside its import statement. (VALIDATION_REQUIRED)
- `web/src/registerServiceWorker.js::unregister` — No runtime, startup, test, or meaningful incident path was found. Treat it as a deletion candidate, not proof of safety. (VALIDATION_REQUIRED)

## Limitations

None.

## Metrics

| Metric | Value |
| --- | ---: |
| Wall-clock time | 0 ms |
| Deterministic time | 0 ms |
| Model requests | 0 |
| Prompt tokens | 0 |
| Completion tokens | 0 |
| Total tokens | 0 |
| Cache | cold |
