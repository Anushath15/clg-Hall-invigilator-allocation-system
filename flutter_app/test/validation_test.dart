import 'package:flutter_test/flutter_test.dart';
import 'package:hias/models/domain/hall_layout.dart';
import 'package:hias/models/domain/validation.dart';

/// Every field rule of every form: each returns null when the value is fine, else a message that says what to change.
void main() {
  void accepts(String? Function(Object?) rule, List<Object?> values) {
    for (final v in values) {
      expect(rule(v), isNull, reason: 'should accept "$v"');
    }
  }

  void refuses(String? Function(Object?) rule, Map<Object?, String> values) {
    values.forEach((v, text) {
      final m = rule(v);
      expect(m, isNotNull, reason: 'should refuse "$v"');
      expect(m, contains(text), reason: 'the message for "$v"');
    });
  }

  group('staff', () {
    test('Staff ID', () {
      accepts(validateStaffId, ['STF001', 'a-1_2/3.4', ' X1 ', 'A' * 20]);
      refuses(validateStaffId, {'': 'required', '   ': 'required', null: 'required', 'A' * 21: 'at most 20', 'ST F1': 'no spaces', 'S#1': 'only letters'});
    });

    test('Full Name', () {
      accepts(validateStaffName, ['Dr. A. Maria Joseph', "O'Neil", 'Anu Priya S', 'Mr. K (HOD)', 'தமிழ் பேராசிரியர்']);
      refuses(validateStaffName, {'': 'required', 'A': 'too short', 'A' * 81: 'at most 80', '12345': 'not only numbers', '#@!': 'not only numbers', 'Anu; Priya': 'not allowed'});
    });

    test('Designation: optional, but not only digits (e.g. "1010")', () {
      accepts(validateDesignation, ['', null, 'Assistant Professor', 'HOD']);
      refuses(validateDesignation, {'1010': 'letters', '### ': 'letters', 'P' * 61: 'at most 60'});
    });

    test('E-mail: optional, but a real address', () {
      accepts(validateEmail, ['', null, 'a@b.com', 'first.last@college.edu.in']);
      refuses(validateEmail, {'a@b': 'not valid', 'a b@c.com': 'not valid', '@c.com': 'not valid', 'a@.com': 'not valid', 'a@b.c': 'not valid'});
      expect(validateEmail('x' * 130 + '@c.com'), contains('at most 120'));
    });

    test('a staff record reports the first problem in field order', () {
      expect(validateStaff(staffId: 'S1', name: 'Anu Priya', designation: 'Professor', email: 'a@b.com'), isNull);
      expect(validateStaff(staffId: '', name: '', designation: '1', email: 'x'), contains('Staff ID'));
      expect(validateStaff(staffId: 'S1', name: '', designation: '1', email: 'x'), contains('Full Name'));
      expect(validateStaff(staffId: 'S1', name: 'Anu', designation: '1010', email: 'x'), contains('Designation'));
      expect(validateStaff(staffId: 'S1', name: 'Anu', designation: 'Prof', email: 'x'), contains('E-mail'));
    });
  });

  group('departments, halls, batches, settings', () {
    test('department code needs a letter, and department name needs letters', () {
      accepts(validateDepartmentCode, ['CSE', 'AI-DS', 'ME1']);
      refuses(validateDepartmentCode, {'': 'required', 'ABCDEFGHIJKLM': 'at most 12', '123': 'at least one letter', 'C S': 'letters and digits', 'C_E': 'letters and digits'});
      accepts(validateDepartmentName, ['Computer Science and Engineering', 'ECE']);
      refuses(validateDepartmentName, {'': 'required', '2024': 'letters', 'N' * 81: 'at most 80'});
    });

    test('hall block and floor are short', () {
      expect(validateHallPlace('Block', 'A Block'), isNull);
      expect(validateHallPlace('Floor', null), isNull);
      expect(validateHallPlace('Block', 'B' * 41), contains('Block can be at most 40'));
    });

    test('batch name and academic year', () {
      accepts(validateBatchName, ['November 2026 End Semester Examinations', 'Model Exam 2']);
      refuses(validateBatchName, {'': 'required', '2026': 'letters', 'B' * 101: 'at most 100'});
      accepts(validateAcademicYear, ['2026-27', '2026-2027', '2099-2100', '2099-00']);
      refuses(validateAcademicYear, {'': 'look like', '2026': 'look like', '2026-28': 'consecutive', '2026-2028': 'consecutive', '26-27': 'look like'});
    });

    test('college names and times of day', () {
      accepts(validateCollegeName, ["St. Xavier's Catholic College of Engineering"]);
      refuses(validateCollegeName, {'': 'required', 'C' * 121: 'at most 120'});
      accepts(validateCollegeShortName, ['SXCCE']);
      refuses(validateCollegeShortName, {'': 'required', 'S' * 13: 'at most 12'});
      accepts(validateTimeOfDay, ['00:00', '09:30', '23:59']);
      refuses(validateTimeOfDay, {'24:00': 'valid', '9:30': 'valid', '09:60': 'valid', '': 'valid', 'noon': 'valid'});
    });

    test('session times: reporting <= start < end', () {
      expect(validateSessionTimes('09:30', '10:00', '13:00'), isNull);
      expect(validateSessionTimes('10:00', '10:00', '13:00'), isNull, reason: 'reporting at the start is allowed');
      expect(validateSessionTimes('', '10:00', '13:00'), contains('all required'));
      expect(validateSessionTimes('09:30', '10:00', ''), contains('all required'));
      expect(validateSessionTimes('9:30', '10:00', '13:00'), contains('valid'));
      expect(validateSessionTimes('10:30', '10:00', '13:00'), contains('at or before'));
      expect(validateSessionTimes('09:30', '10:00', '10:00'), contains('after the exam start'));
      expect(validateSessionTimes('09:30', '10:00', '09:00'), contains('after the exam start'));
    });

    test('hall layout limits', () {
      expect(validateHallLayout(4, 3), isNull);
      expect(validateHallLayout(0, 0), isNull, reason: 'a hall with no layout yet');
      expect(validateHallLayout(-1, 3), isNotNull);
      expect(validateHallLayout(4, -2), isNotNull);
      expect(validateHallLayout(500, 3), contains('at most $maxBenchRows bench rows'));
      expect(validateHallLayout(3, 500), contains('at most $maxBenchCols bench columns'));
      expect(validateHallLayout(3, 0), contains('Enter both'), reason: 'rows without columns is half a layout');
      expect(validateHallLayout('x', 3), contains('whole numbers'));
    });
  });

  group('students and subjects', () {
    test('roll and register numbers', () {
      accepts((v) => validateStudentNumber('Roll Number', v), ['23CS001', '961223104001', 'a.b-c_d/1']);
      refuses((v) => validateStudentNumber('Roll Number', v), {'': 'Roll Number is required', 'A' * 21: 'at most 20', '23 CS 001': 'no spaces', '23#1': 'only letters'});
      expect(validateStudentNumber('Register Number', ''), startsWith('Register Number'));
    });

    test('gender words', () {
      for (final m in ['m', 'M', 'Male', 'male', 'Boy', 'b']) {
        expect(parseGender(m), 'M', reason: m);
      }
      for (final f in ['f', 'F', 'Female', 'female', 'Girl', 'g']) {
        expect(parseGender(f), 'F', reason: f);
      }
      for (final x in ['', 'x', 'other', null]) {
        expect(parseGender(x), isNull, reason: '$x');
      }
    });

    test('batch looks like 2023-2027 and is tidied', () {
      accepts(validateStudentBatch, ['2023-2027', '2023 - 2027', '2024- 2028']);
      refuses(validateStudentBatch, {'': 'look like', '2023': 'look like', '2027-2023': 'after the start', '2023-2023': 'after the start', '23-27': 'look like'});
      expect(normalizeStudentBatch('2023 - 2027'), '2023-2027');
    });

    test('section: a short label, tidied to capitals', () {
      accepts(validateStudentSection, ['A', 'b2', 'A-1', 'A B']);
      refuses(validateStudentSection, {'': 'required', 'S' * 11: 'at most 10', 'A/B': 'only letters', 'A#': 'only letters'});
      expect(normalizeStudentSection('  b   2 '), 'B 2');
    });

    test('a student record reports the first problem in field order', () {
      expect(validateStudent(rollNo: 'R1', registerNo: 'G1', name: 'Anu Priya', gender: 'F', section: 'A', batch: '2023-2027'), isNull);
      expect(validateStudent(rollNo: '', registerNo: '', name: '', gender: '', section: '', batch: ''), contains('Roll Number'));
      expect(validateStudent(rollNo: 'R1', registerNo: 'G1', name: '', gender: '', section: '', batch: ''), contains('Name'));
      expect(validateStudent(rollNo: 'R1', registerNo: 'G1', name: 'Anu', gender: 'x', section: '', batch: ''), contains('Gender'));
      expect(validateStudent(rollNo: 'R1', registerNo: 'G1', name: 'Anu', gender: 'F', section: '', batch: ''), contains('Section'));
      expect(validateStudent(rollNo: 'R1', registerNo: 'G1', name: 'Anu', gender: 'F', section: 'A', batch: ''), contains('Batch'));
    });

    test('student numbers are the same ignoring case, spaces and leading zeros of digits', () {
      expect(studentNumberKey(' ab-1 '), studentNumberKey('AB-1'));
      expect(studentNumberKey('0961'), studentNumberKey('961'));
      expect(studentNumberKey('000'), '0');
      expect(studentNumberKey('X0123'), isNot(studentNumberKey('X123')), reason: 'letters are compared as written');
      expect(studentNumberKey(null), '');
    });

    test('subject code and name', () {
      expect(validateSubject(code: 'CS3401', name: 'Compiler Design'), isNull);
      expect(validateSubject(code: '', name: 'X'), contains('Subject Code is required'));
      expect(validateSubject(code: 'C' * 21, name: 'X'), contains('at most 20'));
      expect(validateSubject(code: '#1', name: 'X'), contains('Subject Code may contain'));
      expect(validateSubject(code: 'CS1', name: ''), contains('Subject Name is required'));
      expect(validateSubject(code: 'CS1', name: 'N' * 121), contains('at most 120'));
    });
  });

  group('deleting a batch', () {
    test('needs the exact batch name, a real name and a Staff ID', () {
      const batch = 'November 2026 End Semester Examinations';
      expect(validateBatchDeletion(batchName: batch, typedBatchName: batch, personName: 'Anu Priya', staffId: 'STF001'), isNull);
      expect(validateBatchDeletion(batchName: batch, typedBatchName: batch.toUpperCase(), personName: 'Anu Priya', staffId: 'STF001'), isNull, reason: 'capitals do not matter');
      expect(validateBatchDeletion(batchName: batch, typedBatchName: '', personName: 'Anu', staffId: 'S1'), contains('Type the batch name'));
      expect(validateBatchDeletion(batchName: batch, typedBatchName: 'Nov', personName: 'Anu', staffId: 'S1'), contains('does not match'));
      expect(validateBatchDeletion(batchName: batch, typedBatchName: batch, personName: '', staffId: 'S1'), contains('Enter your name'));
      expect(validateBatchDeletion(batchName: batch, typedBatchName: batch, personName: '1234', staffId: 'S1'), contains('Your name'));
      expect(validateBatchDeletion(batchName: batch, typedBatchName: batch, personName: 'Anu', staffId: ''), contains('Staff ID'));
      expect(validateBatchDeletion(batchName: batch, typedBatchName: batch, personName: 'Anu', staffId: 'S 1'), contains('Staff ID'));
    });
  });
}
