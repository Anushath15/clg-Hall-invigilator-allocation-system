import '../core/database.dart';
import 'allocation_service.dart';
import 'backup_service.dart';
import 'cycle_service.dart';
import 'file_service.dart';
import 'master_service.dart';
import 'pdf_service.dart';
import 'report_service.dart';
import 'student_service.dart';
import 'subject_service.dart';

/// Every service of the Model layer over one open database, handed to the controllers.
class AppServices {
  AppServices(this.db, {this.appVersion = '1.1.0'})
      : master = MasterService(db),
        cycles = CycleService(db),
        students = StudentService(db),
        subjects = SubjectService(db),
        reports = ReportService(db),
        files = FileService(),
        pdf = PdfService() {
    allocation = AllocationService(db, cycles, students, subjects);
    backup = BackupService(db, appVersion);
  }

  final AppDatabase db;
  final String appVersion;
  final MasterService master;
  final CycleService cycles;
  final StudentService students;
  final SubjectService subjects;
  final ReportService reports;
  final FileService files;
  final PdfService pdf;
  late final AllocationService allocation;
  late final BackupService backup;
}
