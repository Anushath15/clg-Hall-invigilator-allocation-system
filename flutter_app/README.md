# HIAS – Flutter (MVC)

Flutter version of the Hall Invigilator Allocation System. It opens the same database file as the
Electron app (`%APPDATA%\eias\eias.db` on Windows), so existing data appears unchanged.

## Run

```
flutter pub get
flutter run -d windows        # or: flutter build windows --release
flutter test                  # engine tests (rotation draw, seating rules, end-to-end allocation)
```

## Structure (MVC)

```
lib/
  core/          database (SQLite), theme, formatting
  models/        Model: entities + domain rules ported from src/shared
    domain/      assignment (rotation engine), seating, hall layout, validation, schema
  services/      Model: data access (master data, cycles, allocation, students, subjects, reports, PDFs, files, backup)
  controllers/   Controller: one ChangeNotifier per screen
  views/         View: pages, dialogs and shared widgets (no business logic)
```

Not ported: the web-only parts of the Electron app (login, staff self-service page, notifications bell).
