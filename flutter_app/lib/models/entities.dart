import '../core/database.dart';
import 'domain/hall_layout.dart';

/// Typed records read from the database. Each `fromRow` takes a query row.

class Department {
  final int id;
  final String code, name;
  final bool isActive;
  const Department({required this.id, required this.code, required this.name, this.isActive = true});
  factory Department.fromRow(DbRow r) => Department(id: asInt(r['id']), code: asStr(r['code']), name: asStr(r['name']), isActive: asBool(r['is_active'] ?? 1));
}

class Staff {
  final int id;
  final String staffId, name, role;
  final String? email, designation, departmentName, departmentCode;
  final int? departmentId;
  final bool isActive;
  const Staff({required this.id, required this.staffId, required this.name, this.email, this.designation, this.role = 'staff', this.departmentId, this.departmentName, this.departmentCode, this.isActive = true});
  factory Staff.fromRow(DbRow r) => Staff(
        id: asInt(r['id']),
        staffId: asStr(r['staff_id']),
        name: asStr(r['name']),
        email: asStrOrNull(r['email']),
        designation: asStrOrNull(r['designation']),
        role: asStr(r['role'] ?? 'staff'),
        departmentId: asIntOrNull(r['department_id']),
        departmentName: asStrOrNull(r['department_name']),
        departmentCode: asStrOrNull(r['department_code']),
        isActive: asBool(r['is_active']),
      );
}

class Hall {
  final int id, capacity, sortOrder;
  final String hallCode;
  final String? block, floor;
  final bool isActive;
  final HallLayout layout;
  const Hall({required this.id, required this.hallCode, this.block, this.floor, this.capacity = 0, this.sortOrder = 0, this.isActive = true, this.layout = const HallLayout(rows: 0, cols: 0)});
  factory Hall.fromRow(DbRow r) => Hall(
        id: asInt(r['id']),
        hallCode: asStr(r['hall_code']),
        block: asStrOrNull(r['block']),
        floor: asStrOrNull(r['floor']),
        capacity: asInt(r['capacity']),
        sortOrder: asInt(r['sort_order']),
        isActive: asBool(r['is_active']),
        layout: hallLayoutOf(r),
      );
  int get benches => benchCount(layout);
  int get seats => seatCount(layout);
}

class ExamCycle {
  final int id;
  final String name, academicYear, status, createdAt;
  const ExamCycle({required this.id, required this.name, required this.academicYear, required this.status, required this.createdAt});
  factory ExamCycle.fromRow(DbRow r) =>
      ExamCycle(id: asInt(r['id']), name: asStr(r['name']), academicYear: asStr(r['academic_year']), status: asStr(r['status'] ?? 'draft'), createdAt: asStr(r['created_at']));
}

class ExamSession {
  final int id, cycleId, rotationStep;
  final String examDate, sessionType, status;
  final String? reportingTime, examStart, examEnd, createdAt, updatedAt;
  const ExamSession({required this.id, required this.cycleId, required this.examDate, required this.sessionType, required this.rotationStep, this.reportingTime, this.examStart, this.examEnd, required this.status, this.createdAt, this.updatedAt});
  factory ExamSession.fromRow(DbRow r) => ExamSession(
        id: asInt(r['id']),
        cycleId: asInt(r['cycle_id']),
        examDate: asStr(r['exam_date']),
        sessionType: asStr(r['session_type']),
        rotationStep: asInt(r['rotation_step']),
        reportingTime: asStrOrNull(r['reporting_time']),
        examStart: asStrOrNull(r['exam_start']),
        examEnd: asStrOrNull(r['exam_end']),
        status: asStr(r['status'] ?? 'pending'),
        createdAt: asStrOrNull(r['created_at']),
        updatedAt: asStrOrNull(r['updated_at']),
      );
  bool get isConfirmed => status == 'confirmed' || status == 'published';
}

/// One row of a session's invigilator allocation, with staff and hall details.
class AllocationRow {
  final int id, userId, hallId;
  final bool isManuallyEdited;
  final String staffId, userName, hallCode;
  final String? editReason, designation, deptName, deptCode, hallBlock, hallFloor, generatedHallCode;
  const AllocationRow({required this.id, required this.userId, required this.hallId, required this.isManuallyEdited, required this.staffId, required this.userName, required this.hallCode, this.editReason, this.designation, this.deptName, this.deptCode, this.hallBlock, this.hallFloor, this.generatedHallCode});
  factory AllocationRow.fromRow(DbRow r) => AllocationRow(
        id: asInt(r['id']),
        userId: asInt(r['userId']),
        hallId: asInt(r['hallId']),
        isManuallyEdited: asBool(r['is_manually_edited']),
        editReason: asStrOrNull(r['edit_reason']),
        staffId: asStr(r['staff_id']),
        userName: asStr(r['userName']),
        designation: asStrOrNull(r['designation']),
        deptName: asStrOrNull(r['deptName']),
        deptCode: asStrOrNull(r['deptCode']),
        hallCode: asStr(r['hall_code']),
        hallBlock: asStrOrNull(r['hallBlock']),
        hallFloor: asStrOrNull(r['hallFloor']),
        generatedHallCode: asStrOrNull(r['generatedHallCode']),
      );
}

class ValidationIssue {
  final String rule, message;
  final int? userId, hallId;
  const ValidationIssue(this.rule, this.message, {this.userId, this.hallId});
}

class ValidationResult {
  final bool isValid;
  final List<ValidationIssue> blockingErrors;
  final List<String> warnings;
  const ValidationResult(this.isValid, this.blockingErrors, this.warnings);
}

class ValidHall {
  final int hallId;
  final bool isValid;
  final String? reason;
  final int? swapWithUserId;
  const ValidHall(this.hallId, this.isValid, {this.reason, this.swapWithUserId});
}

class Student {
  final int id;
  final String rollNo, registerNo, name, gender, section, batch;
  final int? departmentId;
  final String? departmentCode, departmentName;
  final bool isActive;
  const Student({required this.id, required this.rollNo, required this.registerNo, required this.name, required this.gender, this.departmentId, this.departmentCode, this.departmentName, required this.section, required this.batch, this.isActive = true});
  factory Student.fromRow(DbRow r) => Student(
        id: asInt(r['id']),
        rollNo: asStr(r['roll_no']),
        registerNo: asStr(r['register_no']),
        name: asStr(r['name']),
        gender: asStr(r['gender']),
        departmentId: asIntOrNull(r['department_id']),
        departmentCode: asStrOrNull(r['department_code']),
        departmentName: asStrOrNull(r['department_name']),
        section: asStr(r['section']),
        batch: asStr(r['batch']),
        isActive: asBool(r['is_active']),
      );
}

class Subject {
  final int id;
  final String code, name;
  final int? departmentId;
  final String? departmentCode;
  final bool isActive;
  final List<Staff> staff;
  final List<int> studentIds;
  const Subject({required this.id, required this.code, required this.name, this.departmentId, this.departmentCode, this.isActive = true, this.staff = const [], this.studentIds = const []});
}

/// One saved seat of a session, with student and hall details.
class SeatRow {
  final int studentId, hallId, benchRow, benchCol, benchNo;
  final String rollNo, registerNo, studentName, gender, batch, hallCode, seat;
  final String? deptCode, deptName, hallBlock, hallFloor, year, category;
  const SeatRow({required this.studentId, required this.rollNo, this.registerNo = '', required this.studentName, required this.gender, required this.batch, this.deptCode, this.deptName, required this.hallId, required this.hallCode, this.hallBlock, this.hallFloor, required this.benchRow, required this.benchCol, required this.benchNo, required this.seat, this.year, this.category});
  /// The colour / class key: department and year, else year, else batch.
  String get colorKey => (category?.isNotEmpty ?? false) ? category! : ((year?.isNotEmpty ?? false) ? year! : batch);
}

class StaffDutyRow {
  final String examDate, sessionType, status, hallCode, cycleName, academicYear;
  final String? reportingTime, examStart, examEnd, hallName, hallBlock, hallFloor;
  final int hallId;
  final bool isManuallyEdited;
  const StaffDutyRow({required this.examDate, required this.sessionType, required this.status, this.reportingTime, this.examStart, this.examEnd, required this.hallId, required this.hallCode, this.hallName, this.hallBlock, this.hallFloor, required this.cycleName, required this.academicYear, required this.isManuallyEdited});
  factory StaffDutyRow.fromRow(DbRow r) => StaffDutyRow(
        examDate: asStr(r['exam_date']),
        sessionType: asStr(r['session_type']),
        status: asStr(r['status']),
        reportingTime: asStrOrNull(r['reporting_time']),
        examStart: asStrOrNull(r['exam_start']),
        examEnd: asStrOrNull(r['exam_end']),
        hallId: asInt(r['hallId']),
        hallCode: asStr(r['hall_code']),
        hallName: asStrOrNull(r['hallName']),
        hallBlock: asStrOrNull(r['hallBlock']),
        hallFloor: asStrOrNull(r['hallFloor']),
        cycleName: asStr(r['cycleName']),
        academicYear: asStr(r['academic_year']),
        isManuallyEdited: asBool(r['is_manually_edited']),
      );
}

class DashboardStats {
  final int totalStaff, totalHalls, totalStudents, totalBoys, totalCycles, confirmedSessions, upcomingSessions, pendingAllocations, allocatedHalls, totalExamDays;
  const DashboardStats({this.totalStaff = 0, this.totalHalls = 0, this.totalStudents = 0, this.totalBoys = 0, this.totalCycles = 0, this.confirmedSessions = 0, this.upcomingSessions = 0, this.pendingAllocations = 0, this.allocatedHalls = 0, this.totalExamDays = 0});
}

class DeletedBatch {
  final int id, sessionCount, confirmedSessionCount, allocationCount;
  final String batchName, deletedAt, deletedByName, deletedByStaffId;
  final String? academicYear, status;
  const DeletedBatch({required this.id, required this.batchName, this.academicYear, this.status, required this.sessionCount, required this.confirmedSessionCount, required this.allocationCount, required this.deletedAt, required this.deletedByName, required this.deletedByStaffId});
  factory DeletedBatch.fromRow(DbRow r) => DeletedBatch(
        id: asInt(r['id']),
        batchName: asStr(r['batch_name']),
        academicYear: asStrOrNull(r['academic_year']),
        status: asStrOrNull(r['status']),
        sessionCount: asInt(r['session_count']),
        confirmedSessionCount: asInt(r['confirmed_session_count']),
        allocationCount: asInt(r['allocation_count']),
        deletedAt: asStr(r['deleted_at']),
        deletedByName: asStr(r['deleted_by_name']),
        deletedByStaffId: asStr(r['deleted_by_staff_id']),
      );
}

/// The outcome of an import: how many rows were saved, and why each skipped row was skipped.
class ImportResult {
  final bool success;
  final String? error;
  final List<String> missingColumns;
  final int inserted;
  final List<({int row, String reason})> issues;
  const ImportResult({required this.success, this.error, this.missingColumns = const [], this.inserted = 0, this.issues = const []});
  const ImportResult.fail(String this.error, {this.missingColumns = const []})
      : success = false,
        inserted = 0,
        issues = const [];
}

/// A simple success / error outcome of an action.
class ActionResult<T> {
  final bool success;
  final String? error;
  final T? value;
  const ActionResult.ok([this.value])
      : success = true,
        error = null;
  const ActionResult.fail(String this.error)
      : success = false,
        value = null;
}

/// A hall of a session as the seating screens and PDFs show it: its layout and invigilators.
class SeatingHallInfo {
  final int id;
  final String hallCode;
  final String? block, floor;
  final List<String> invigilators;
  final HallLayout layout;
  const SeatingHallInfo({required this.id, required this.hallCode, this.block, this.floor, this.invigilators = const [], required this.layout});
  int get benches => benchCount(layout);
  int get seats => seatCount(layout);
  List<Bench> get benchList => enabledBenches(layout);
}
