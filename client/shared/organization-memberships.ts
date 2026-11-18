type OrganizationSnapshot = {
  units: { id: string; name: string }[];
  departments: {
    id: string;
    unit_id: string;
    parent_id: string | null;
    name: string;
    is_root: boolean;
  }[];
};

type OrganizationAssignment = {
  unit_id: string;
  department_id: string;
  is_primary: boolean;
};

export function buildOrganizationMemberships(
  snapshot: OrganizationSnapshot,
  assignments: OrganizationAssignment[],
) {
  return assignments
    .map((assignment) => {
      const unit = snapshot.units.find(
        (item) => item.id === assignment.unit_id,
      );
      const department = snapshot.departments.find(
        (item) =>
          item.id === assignment.department_id &&
          item.unit_id === assignment.unit_id,
      );
      // Do not fabricate a location when the current visibility scope omits it.
      if (!unit || (!department && assignment.department_id)) return null;
      const names: string[] = [];
      const seen = new Set<string>();
      let current: typeof department | undefined = department;
      while (current && !current.is_root && !seen.has(current.id)) {
        seen.add(current.id);
        if (current.name.trim()) names.unshift(current.name);
        current = snapshot.departments.find(
          (item) => item.id === current?.parent_id && item.unit_id === unit.id,
        );
      }
      return {
        unit: unit.name,
        department: names.join(" / "),
        isPrimary: assignment.is_primary,
        departmentID: assignment.department_id || `unit:${assignment.unit_id}`,
      };
    })
    .filter((item) => item !== null)
    .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary));
}

export function formatOrganizationMembership(membership: {
  unit: string;
  department: string;
  isPrimary: boolean;
}) {
  return [membership.unit, membership.department].filter(Boolean).join(" / ");
}
