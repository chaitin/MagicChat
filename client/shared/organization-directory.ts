export type OrganizationDirectorySnapshot = {
  units: { id: string; parent_id: string | null; name: string; kind: string; member_count?: number }[];
  departments: {
    id: string;
    unit_id: string;
    parent_id: string | null;
    name: string;
    is_root: boolean;
    member_count?: number;
  }[];
};

export type OrganizationDirectoryNode = {
  key: string;
  name: string;
  kind: "unit" | "department";
  departmentId: string | null;
  defaultOpen: boolean;
  memberCount?: number;
  children: OrganizationDirectoryNode[];
};

// Keep matching ancestors so a search result still has its organization context.
export function buildOrganizationDirectoryTree(
  snapshot: OrganizationDirectorySnapshot,
  keyword = "",
): OrganizationDirectoryNode[] {
  const query = keyword.trim().toLocaleLowerCase();
  const units = new Map(snapshot.units.map((unit) => [unit.id, unit]));
  const departments = new Map(
    snapshot.departments.map((department) => [department.id, department]),
  );
  const departmentNode = (
    id: string,
    ancestors: Set<string>,
  ): OrganizationDirectoryNode | null => {
    const department = departments.get(id);
    if (!department || ancestors.has(id)) return null;
    const next = new Set(ancestors).add(id);
    return {
      key: `department:${id}`,
      name: department.name,
      memberCount: department.member_count,
      kind: "department",
      departmentId: id,
      defaultOpen: false,
      children: snapshot.departments
        .filter(
          (child) =>
            child.parent_id === id &&
            child.unit_id === department.unit_id &&
            !child.is_root,
        )
        .flatMap((child) => {
          const node = departmentNode(child.id, next);
          return node ? [node] : [];
        }),
    };
  };
  const unitNode = (
    id: string,
    ancestors: Set<string>,
  ): OrganizationDirectoryNode | null => {
    const unit = units.get(id);
    if (!unit || ancestors.has(id)) return null;
    const next = new Set(ancestors).add(id);
    return {
      key: `unit:${id}`,
      name: unit.name,
      memberCount: unit.member_count,
      kind: "unit",
      departmentId:
        snapshot.departments.find(
          (department) => department.unit_id === id && department.is_root,
        )?.id ?? null,
      defaultOpen: unit.kind === "group",
      children: [
        ...snapshot.departments
          .filter(
            (department) =>
              department.unit_id === id &&
              !department.is_root &&
              (!department.parent_id ||
                !departments.has(department.parent_id) ||
                departments.get(department.parent_id)?.is_root),
          )
          .flatMap((department) => {
            const node = departmentNode(department.id, new Set());
            return node ? [node] : [];
          }),
        ...snapshot.units
          .filter((child) => child.parent_id === id)
          .flatMap((child) => {
            const node = unitNode(child.id, next);
            return node ? [node] : [];
          }),
      ],
    };
  };
  const filter = (
    node: OrganizationDirectoryNode,
    includeChildren = false,
  ): OrganizationDirectoryNode | null => {
    const matches =
      includeChildren ||
      !query ||
      node.name.toLocaleLowerCase().includes(query);
    const children = node.children.flatMap((child) => {
      const filtered = filter(child, matches && node.kind === "unit");
      return filtered ? [filtered] : [];
    });
    return matches || children.length ? { ...node, children } : null;
  };
  return snapshot.units
    .filter((unit) => !unit.parent_id || !units.has(unit.parent_id))
    .flatMap((unit) => {
      const node = unitNode(unit.id, new Set());
      const filtered = node && filter(node);
      return filtered ? [filtered] : [];
    });
}

export function matchesOrganizationMember(
  user: { name: string; nickname?: string; email?: string; phone?: string },
  keyword: string,
) {
  const query = keyword.trim().toLocaleLowerCase();
  return [
    user.name,
    user.nickname,
    user.email,
    user.phone,
    user.phone?.replace(/\D/g, ""),
  ].some((value) => value?.toLocaleLowerCase().includes(query));
}

export type OrganizationMemberPage<T> = { members: T[]; total: number };
export type OrganizationMemberState<T> = OrganizationMemberPage<T> & {
  page: number;
  loading: boolean;
  error: string;
};

// Advance only after success: rapid clicks share one request and retry cannot skip a page.
export class OrganizationMemberPager<T extends { id: string }> {
  private state: OrganizationMemberState<T> = {
    members: [],
    total: 0,
    page: 0,
    loading: false,
    error: "",
  };
  private listeners = new Set<() => void>();
  private inFlight: Promise<void> | null = null;
  private readonly read: (page: number) => Promise<OrganizationMemberPage<T>>;
  constructor(read: (page: number) => Promise<OrganizationMemberPage<T>>) {
    this.read = read;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(value: Partial<OrganizationMemberState<T>>) {
    this.state = { ...this.state, ...value };
    for (const listener of this.listeners) listener();
  }
  loadNext = (): Promise<void> => {
    if (this.inFlight) return this.inFlight;
    if (this.state.page > 0 && this.state.members.length >= this.state.total)
      return Promise.resolve();
    const page = this.state.page + 1;
    this.update({ loading: true, error: "" });
    this.inFlight = Promise.resolve()
      .then(() => this.read(page))
      .then((result) => {
        const members = new Map(
          this.state.members.map((member) => [member.id, member]),
        );
        for (const member of result.members) members.set(member.id, member);
        this.update({
          members: [...members.values()],
          total: result.total,
          page,
        });
      })
      .catch((error: unknown) => {
        this.update({
          error: error instanceof Error ? error.message : "加载成员失败",
        });
      })
      .finally(() => {
        this.inFlight = null;
        this.update({ loading: false });
      });
    return this.inFlight;
  };
}
