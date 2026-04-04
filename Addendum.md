You are a senior full-stack architect and security-conscious product engineer.

Your task is to add a production-ready **community feed** feature to my already-built app.

The app already exists and is inspired by Anycase.ai, Digest AI, JurisChat, and eCodal+, but I now want a **social/community layer** similar in feel to an Instagram-inspired feed.

The community feed must support:
- text posts
- exactly one image per post maximum
- comments
- likes/reactions
- saved posts / bookmarks
- optional hashtags/tags if useful
- clean mobile-first UX for both web and React Native clients

The uploaded image must:
- be limited to one image per post
- be validated and sanitized securely
- be processed and reduced in size before permanent storage
- be stripped of unnecessary metadata unless explicitly required
- be safely stored in AWS S3
- be protected against image bombs, malformed image attacks, oversized payloads, and unsafe file upload behavior

Follow best industry standards for:
- community feed architecture
- secure image upload
- image processing pipeline
- AWS S3 storage
- backend validation
- frontend UX
- performance
- moderation readiness
- abuse prevention
- observability
- scalability

==================================================
1. PRIMARY GOAL
==================================================

Add a scalable, production-ready community feed feature to my app with these properties:

1. users can create a post with text and optionally exactly one image
2. users cannot upload more than one image per post
3. uploaded images are safely validated before processing
4. uploaded images are resized/compressed/normalized before long-term storage
5. permanent image storage uses AWS S3
6. uploads are protected against malicious files, image bombs, oversized files, metadata leakage, and abuse
7. the feature works cleanly for both web and React Native mobile clients
8. the design is extensible for future moderation, reporting, and ranking features

==================================================
2. PRODUCT REQUIREMENTS
==================================================

Build an Instagram-inspired feed experience, but adapted to my app’s domain and brand.

Support:
- create post
- edit post
- delete post
- soft delete post
- publish/unpublish if moderation is needed
- one image max per post
- text-only posts
- image + text posts
- feed timeline
- user profile feed
- comments
- like/react
- save/bookmark
- share/copy link if useful
- report post
- basic moderation-ready hooks
- pagination or infinite scroll
- mobile-friendly layout
- efficient image loading
- skeleton loaders and graceful fallback states

Optional but architecture-ready:
- hashtags
- mentions
- pinned posts
- post visibility
- topic/category tags

==================================================
3. IMAGE RULES
==================================================

Enforce these rules strictly:

- maximum one image per post
- allowlist image formats only
- do not trust client-provided MIME type alone
- verify actual file signature / magic bytes server-side
- reject unsupported or suspicious image formats
- enforce maximum upload byte size before processing
- enforce maximum decoded pixel dimensions
- protect against decompression bombs / image bombs
- strip EXIF and unnecessary metadata unless there is an explicit reason to keep it
- normalize output format where appropriate
- generate application-owned safe filenames
- do not use user-supplied filename as storage key
- do not make original untrusted uploads directly public
- do not permanently store unsafe originals before validation
- only store processed/approved output in the public media bucket/path
- preserve a private quarantine path only if needed for debugging/moderation

==================================================
4. SECURITY REQUIREMENTS FOR IMAGE UPLOADS
==================================================

Follow secure file-upload design.

Implement these protections:

A. Request validation
- require authenticated user
- enforce per-user and per-org rate limits
- validate post payload size
- validate text length
- reject multiple image attachments

B. File validation
- validate extension using allowlist
- validate true content type using file signature / magic bytes
- reject mismatched MIME and signature
- enforce max raw file size
- enforce max width/height after parsing headers
- reject malformed image structures
- reject zip/polyglot/script files disguised as images
- reject animated or multi-frame formats unless explicitly supported
- reject SVG unless you have a strong sanitizer and explicit business need; default to not allowing SVG

C. Image bomb protections
- check decoded dimensions before full processing
- cap megapixels and decoded memory usage
- fail closed on parser errors
- apply processing timeouts
- isolate processing in a safe worker path if appropriate
- do not let oversized decoded images exhaust memory or CPU

D. Metadata/privacy protections
- strip EXIF/GPS and unnecessary metadata by default
- auto-orient safely if needed before output
- normalize color/profile only if needed
- avoid leaking device/location metadata to other users

E. Storage protections
- use presigned upload flow or secure backend upload strategy
- store in S3 using application-generated object keys
- never expose raw bucket write credentials to clients
- use least privilege IAM
- store private originals only if truly necessary
- serve approved images through controlled public URLs or CDN strategy
- keep bucket policy tight
- validate object ownership and path scope

F. Abuse protections
- limit uploads per minute/hour/day
- detect repeated invalid upload attempts
- log suspicious file upload behavior
- support temporary blocking for abusive clients
- prepare hooks for malware scanning if required later

==================================================
5. IMAGE PROCESSING PIPELINE
==================================================

Design the upload flow so that images are safely processed before long-term use.

Required pipeline:

1. user requests upload session
2. backend validates intent and issues safe upload contract
3. image is uploaded through a secure path
4. backend/worker validates the uploaded file
5. processor reads image safely
6. reject on invalid signature, format, size, dimensions, or suspicious structure
7. auto-orient if needed
8. resize to app-defined max dimensions
9. compress and optimize for web/mobile delivery
10. strip metadata
11. generate one or more derivatives if useful:
   - feed image
   - thumbnail
   - optional higher-resolution detail image
12. save processed outputs to S3
13. record metadata in database
14. mark media asset status as ready
15. allow post creation/publication only after successful processing

Do not make the feed depend on unprocessed client originals.

==================================================
6. AWS S3 STORAGE REQUIREMENTS
==================================================

Use AWS S3 in a secure and scalable way.

Design the system using best practices such as:
- presigned upload URLs or presigned POST where appropriate
- short expiration times
- tight object key scope
- content-length restrictions where possible
- separate bucket or prefixes for:
  - temporary uploads
  - processed public feed media
  - private moderation/quarantine if needed
- object keys generated by the app, not by clients
- safe content disposition / content type metadata
- lifecycle rules for temporary uploads
- optional CDN-ready structure
- no public write access
- no broad wildcard permissions beyond need

==================================================
7. COMMUNITY FEED BACKEND REQUIREMENTS
==================================================

Implement backend modules/services for:

A. Post service
- create post
- edit post
- delete post
- soft delete
- get post
- list feed
- list profile posts
- attach one processed media asset max
- enforce ownership and permissions

B. Media service
- create upload intent
- validate uploaded object
- process image
- save derivatives
- attach media to post
- delete or detach media
- handle failed processing
- maintain media status lifecycle

C. Feed service
- timeline query
- profile feed query
- pagination / cursor-based pagination
- ranking strategy (simple chronological first unless otherwise specified)
- efficient joins and caching if appropriate

D. Interaction service
- like/unlike
- comment add/edit/delete
- bookmark save/remove
- report post
- moderation flags

E. Moderation readiness
- report reasons
- block/hidden states
- admin moderation hooks
- safety audit logs

==================================================
8. DATABASE REQUIREMENTS
==================================================

Design a clean schema for at least the following entities:

- posts
- post_media
- comments
- post_likes or reactions
- post_bookmarks
- post_reports
- media_processing_jobs
- moderation_flags
- feed_audit_logs

Suggested fields:

posts:
- id
- author_id
- text_content
- status
- visibility
- media_id nullable
- comment_count
- like_count
- bookmark_count
- created_at
- updated_at
- deleted_at

post_media:
- id
- owner_user_id
- source_type
- storage_key_original_temp nullable
- storage_key_processed
- storage_key_thumbnail nullable
- bucket_name
- mime_type
- width
- height
- file_size_bytes
- sha256
- processing_status
- moderation_status
- created_at
- updated_at

media_processing_jobs:
- id
- media_id
- status
- failure_reason
- attempts
- started_at
- finished_at

Ensure the schema supports:
- exactly one media item per post
- soft deletion
- auditability
- future moderation
- future CDN/image derivative support

==================================================
9. FRONTEND REQUIREMENTS
==================================================

Build the UX for both web and React Native clients.

Support:
- feed list
- create post modal/screen
- one image selector only
- image preview before submit
- remove selected image action
- upload progress state
- processing state
- publish state only after media ready
- error messages for invalid image
- text-only fallback
- comments UI
- like/save/report actions
- profile feed

UX constraints:
- mobile-first feed cards
- performant image rendering
- graceful loading states
- infinite scroll or cursor pagination
- clear validation if user tries to attach more than one image

==================================================
10. PERFORMANCE REQUIREMENTS
==================================================

Implement with performance in mind.

Include:
- cursor-based pagination
- feed query indexes
- image thumbnails for feed cards
- lazy loading
- optimized image sizes
- avoid downloading full-size originals into feed cards
- cache-control strategy where appropriate
- background processing for image transformations
- no blocking request path for expensive image work if async is better

==================================================
11. MODERATION AND ABUSE-READINESS
==================================================

Even if full moderation is not built yet, prepare the architecture for:

- report post
- hide post
- remove post
- user strike system hooks
- keyword/risk scoring hooks
- admin review queue hooks
- media moderation status
- audit log of moderation actions

==================================================
12. TESTING REQUIREMENTS
==================================================

Include tests for:

- one image only enforcement
- invalid MIME rejection
- bad signature rejection
- oversized file rejection
- oversized decoded image rejection
- malformed image rejection
- metadata stripping behavior
- successful resize/compression behavior
- secure S3 key generation
- unauthorized upload rejection
- abuse/rate-limit behavior
- post create/edit/delete
- feed pagination
- comments, likes, bookmarks
- media processing failure handling
- post cannot publish with invalid media state
- ownership and permission checks

==================================================
13. IMPLEMENTATION CONSTRAINTS
==================================================

Follow these constraints strictly:

- do not trust frontend-only validation
- do not let raw user uploads go directly into the public feed
- do not store multiple images per post
- do not rely solely on Content-Type header
- do not keep sensitive image metadata unless explicitly required
- do not use user filenames as final storage keys
- do not couple expensive image processing to a fragile synchronous path if it harms reliability
- do not make the design impossible to extend later

==================================================
14. REQUIRED OUTPUT FORMAT
==================================================

Respond with:

1. proposed architecture
2. database schema
3. backend module structure
4. upload and image-processing flow
5. AWS S3 storage design
6. frontend integration plan for web and React Native
7. security and abuse-prevention plan
8. performance strategy
9. test plan
10. phased implementation order

==================================================
15. FINAL EXPECTATION
==================================================

==================================================
16. REACT NATIVE MOBILE-SPECIFIC REQUIREMENTS
==================================================

The community feed must be fully implemented for the React Native mobile app on both iOS and Android.

Design and implement the mobile feature with platform-aware behavior for:
- iOS
- Android

Support the following mobile-specific flows:
- create post screen
- select one image only from gallery
- optional camera capture if already supported in the app
- preview selected image before upload
- remove/replace image before publish
- text-only post support
- upload progress indicator
- upload failure and retry behavior
- media processing state handling
- final publish state only after backend confirms safe processed asset
- feed timeline screen
- profile posts screen
- comments screen
- likes, bookmarks, and report actions

React Native implementation must include:
- image picker integration
- camera/gallery permissions handling for iOS and Android
- file size pre-check on device if possible
- prevention of selecting multiple images
- mobile-safe compression preview only if useful, but final security validation must still happen server-side
- safe cancellation and retry of uploads
- proper handling of app backgrounding/interruption during upload
- user-friendly error messages for invalid image, oversized image, or processing failure
- compatibility with both iOS and Android UI conventions

The mobile implementation must also define:
- which React Native libraries/packages to use for image picking and upload
- how to handle platform permissions
- how to handle presigned upload flow from mobile
- how to handle temporary local file URIs
- how to handle upload progress UI
- how to sync final processed media record to the post creation flow
- how to keep the mobile feed performant with thumbnails and lazy loading

Do not assume web upload behavior is enough for mobile.
Design explicitly for React Native on both iOS and Android.

Give a concrete, production-ready implementation plan and code-oriented design.

Prefer stable, secure, industry-standard approaches.
Be especially strict about image-upload security, safe processing, and one-image-per-post enforcement.