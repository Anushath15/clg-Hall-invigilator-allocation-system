import 'package:flutter/foundation.dart';

import '../core/format.dart';
import '../models/domain/hall_layout.dart';
import '../models/entities.dart';
import '../services/app_services.dart';
import '../services/student_service.dart';
import '../services/subject_service.dart';

/// Master Data → Staff / Invigilators.
class StaffController extends ChangeNotifier {
  StaffController(this.services) {
    load();
  }
  final AppServices services;
  List<Staff> staff = [];
  List<Department> departments = [];

  /// The active subjects a staff member handles (Master Data → Subjects), by code.
  List<Subject> subjectsOf(Staff member) =>
      services.subjects.list().where((sb) => sb.isActive && sb.staff.any((x) => x.id == member.id)).toList()..sort((a, b) => textCompare(a.code, b.code));
  void load() {
    staff = services.master.staff(role: 'staff')..sort((a, b) => naturalCompare(a.staffId, b.staffId));
    departments = services.master.departments();
    notifyListeners();
  }

  String? save({int? id, required String staffId, required String name, String? designation, String? email, int? departmentId, required bool isActive}) {
    final r = services.master.saveStaff(id: id, staffId: staffId, name: name, designation: designation, email: email, departmentId: departmentId, isActive: isActive);
    if (r.success) load();
    return r.error;
  }

  void deactivate(int id) {
    services.master.deactivateStaff(id);
    load();
  }

  String? hardDelete(int id) {
    final r = services.master.hardDeleteStaff(id);
    if (r.success) load();
    return r.error;
  }

  Future<ImportResult?> importExcel() async {
    final sheet = await services.files.pickSheet();
    if (sheet == null) return null;
    final r = services.master.importStaff(sheet.rows);
    if (r.success) load();
    return r;
  }
}

/// Master Data → Halls.
class HallsController extends ChangeNotifier {
  HallsController(this.services) {
    load();
  }
  final AppServices services;
  List<Hall> halls = [];

  void load() {
    halls = services.master.halls();
    notifyListeners();
  }

  String? save({int? id, required String hallCode, String? block, String? floor, int capacity = 0, required bool isActive, required HallLayout layout}) {
    final r = services.master.saveHall(id: id, hallCode: hallCode, block: block, floor: floor, capacity: capacity, isActive: isActive, layout: layout);
    if (r.success) load();
    return r.error;
  }

  String? delete(int id) {
    final r = services.master.deleteHall(id);
    if (r.success) load();
    return r.error;
  }
}

/// Master Data → Departments.
class DepartmentsController extends ChangeNotifier {
  DepartmentsController(this.services) {
    load();
  }
  final AppServices services;
  List<Department> departments = [];

  void load() {
    departments = services.master.departments();
    notifyListeners();
  }

  String? save({int? id, required String code, required String name}) {
    final r = services.master.saveDepartment(id: id, code: code, name: name);
    if (r.success) load();
    return r.error;
  }

  String? delete(int id) {
    final r = services.master.deleteDepartment(id);
    if (r.success) load();
    return r.error;
  }
}

/// Master Data → Students, with its filters.
class StudentsController extends ChangeNotifier {
  StudentsController(this.services) {
    load();
  }
  final AppServices services;
  List<Student> students = [];
  List<Department> departments = [];
  String query = '', batch = '', section = '', gender = '';
  int? departmentId;

  /// The active subjects a student studies (those the student is mapped to in Master Data → Subjects), by code.
  List<Subject> subjectsOf(Student student) =>
      services.subjects.list().where((sb) => sb.isActive && sb.studentIds.contains(student.id)).toList()..sort((a, b) => textCompare(a.code, b.code));
  void load() {
    students = services.students.list();
    departments = services.master.departments();
    notifyListeners();
  }

  void setFilter({String? query, String? batch, String? section, String? gender, int? departmentId, bool clearDepartment = false}) {
    if (query != null) this.query = query;
    if (batch != null) this.batch = batch;
    if (section != null) this.section = section;
    if (gender != null) this.gender = gender;
    if (departmentId != null || clearDepartment) this.departmentId = departmentId;
    notifyListeners();
  }

  List<String> get batches => (students.map((s) => s.batch).toSet().toList()..sort());
  List<String> get sections => (students.map((s) => s.section).where((s) => s.isNotEmpty).toSet().toList()..sort());

  List<Student> get shown => students
      .where((s) =>
          (batch.isEmpty || s.batch == batch) &&
          (departmentId == null || s.departmentId == departmentId) &&
          (section.isEmpty || s.section == section) &&
          (gender.isEmpty || s.gender == gender) &&
          matchesSearch(query, [s.rollNo, s.registerNo, s.name]))
      .toList();

  List<({String batch, int boys, int girls})> get summary => [
        for (final b in batches)
          (
            batch: b,
            boys: students.where((s) => s.batch == b && s.isActive && s.gender == 'M').length,
            girls: students.where((s) => s.batch == b && s.isActive && s.gender == 'F').length,
          )
      ];

  String? save({int? id, required String rollNo, required String registerNo, required String name, required String gender, int? departmentId, required String section, required String batch, required bool isActive}) {
    final r = services.students.save(id: id, rollNo: rollNo, registerNo: registerNo, name: name, gender: gender, departmentId: departmentId, section: section, batch: batch, isActive: isActive);
    if (r.success) load();
    return r.error;
  }

  String? delete(int id) {
    final r = services.students.delete(id);
    if (r.success) load();
    return r.error;
  }

  Future<ImportResult?> importExcel() async {
    final sheet = await services.files.pickSheet();
    if (sheet == null) return null;
    final r = services.students.importStudents(sheet.rows);
    if (r.success) load();
    return r;
  }

  Future<String?> downloadTemplate() => services.files.saveTemplate(
        'HIAS-Student-Import-Template.xlsx',
        'Students',
        [StudentService.importColumns, ['23CS001', '961223104001', 'Anu S', 'Female', departments.firstOrNull?.code ?? 'CSE', 'A', '2023-2027']],
        widths: [12, 16, 26, 9, 12, 9, 11],
      );
}

/// Master Data → Subjects: the subject master, the staff who handle each subject and the students who study it.
class SubjectsController extends ChangeNotifier {
  SubjectsController(this.services) {
    load();
  }
  final AppServices services;
  List<Subject> subjects = [];
  List<Department> departments = [];
  List<Staff> staff = [];
  String query = '';

  void load() {
    subjects = services.subjects.list();
    departments = services.master.departments();
    staff = services.master.staff(role: 'staff').where((s) => s.isActive).toList();
    notifyListeners();
  }

  void setQuery(String q) {
    query = q;
    notifyListeners();
  }

  List<Subject> get shown => subjects.where((s) => matchesSearch(query, [s.code, s.name, ...s.staff.map((u) => u.name)])).toList();

  String? save({int? id, required String code, required String name, int? departmentId, required bool isActive, required List<int> staffIds}) {
    final r = services.subjects.save(id: id, code: code, name: name, departmentId: departmentId, isActive: isActive, staffIds: staffIds);
    if (r.success) load();
    return r.error;
  }

  void delete(int id) {
    services.subjects.delete(id);
    load();
  }

  List<Student> activeStudents() => services.students.list(isActive: true);

  String? setStudents(int subjectId, List<int> ids) {
    final r = services.subjects.setStudents(subjectId, ids);
    if (r.success) load();
    return r.error;
  }

  Future<ImportResult?> importSubjects({bool studentMapping = false}) async {
    final sheet = await services.files.pickSheet();
    if (sheet == null) return null;
    final r = studentMapping ? services.subjects.importStudentSubjects(sheet.rows) : services.subjects.importSubjects(sheet.rows);
    if (r.success) load();
    return r;
  }

  Future<String?> downloadTemplate() => services.files.saveTemplate(
        'HIAS-Subject-Import-Template.xlsx',
        'Subjects',
        [
          ['Subject Code', 'Subject Name', 'Department', 'Staff IDs'],
          ['CS3401', 'Compiler Design', departments.firstOrNull?.code ?? 'CSE', staff.take(2).map((u) => u.staffId).join('; ')]
        ],
        widths: [14, 32, 12, 24],
      );

  Future<String?> downloadMappingTemplate() => services.files.saveTemplate(
        'HIAS-Student-Subjects-Template.xlsx',
        'Student Subjects',
        [
          ['Roll No', 'Subject Codes'],
          ['23CS001', subjects.isEmpty ? 'CS3401; CS3402' : subjects.take(3).map((s) => s.code).join('; ')]
        ],
        widths: [14, 40],
      );

  static List<String> get mappingColumns => SubjectService.studentSubjectImportColumns;
  static List<String> get importColumns => SubjectService.subjectImportColumns;
}
