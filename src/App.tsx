import { useEffect, useRef, useState, type FormEvent } from "react";
import { get, post } from "aws-amplify/api";
import {
  confirmSignIn,
  fetchAuthSession,
  getCurrentUser,
  signIn,
  signOut,
} from "aws-amplify/auth";
import outputs from "../amplify_outputs.json";

type PageKey =
  | "congregation"
  | "visitation"
  | "new-member"
  | "member-details"
  | "announcement-week"
  | "user-access"
  | "events"
  | "sunday-school"
  | "summer-camp"
  | "parking"
  | "board-meeting"
  | "announcements";

const pageContent: Record<
  PageKey,
  { eyebrow: string; description: string }
> = {
  congregation: {
    eyebrow: "Congregation",
    description: "",
  },
  visitation: {
    eyebrow: "Visitation",
    description: "",
  },
  "new-member": {
    eyebrow: "New Member",
    description:
      "Capture the basic details for a congregation member.",
  },
  "member-details": {
    eyebrow: "Member Details",
    description: "",
  },
  "announcement-week": {
    eyebrow: "Add Week",
    description: "",
  },
  "user-access": {
    eyebrow: "User Access",
    description: "",
  },
  events: {
    eyebrow: "Events",
    description: "",
  },
  "sunday-school": {
    eyebrow: "Sunday School",
    description: "",
  },
  "summer-camp": {
    eyebrow: "Summer Camp",
    description: "",
  },
  parking: {
    eyebrow: "Parking",
    description: "",
  },
  "board-meeting": {
    eyebrow: "Board Meeting",
    description: "",
  },
  announcements: {
    eyebrow: "Announcements",
    description: "",
  },
};

const navSections: Array<{
  label: string;
  items: Array<{ key: PageKey; label: string }>;
}> = [
  {
    label: "Workspace",
    items: [
      { key: "congregation", label: "Congregation" },
      { key: "visitation", label: "Visitation" },
      { key: "announcements", label: "Announcements" },
      { key: "events", label: "Events" },
      { key: "sunday-school", label: "Sunday School" },
      { key: "summer-camp", label: "Summer Camp" },
      { key: "parking", label: "Parking" },
      { key: "board-meeting", label: "Board Meeting" },
    ],
  },
  {
    label: "Manage",
    items: [{ key: "user-access", label: "User Access" }],
  },
];

type BackendMessage = {
  message: string;
  time: string;
  items: Array<{
    pk: string;
    sk: string;
    data: string;
  }>;
};

type AnnouncementResponse = {
  message: string;
  time: string;
  items: Array<{
    pk: string;
    sk: string;
    data: string;
  }>;
};

type MemberFormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  address: string;
  notes: string;
};

type StoredMemberData = Partial<MemberFormState> & {
  createdAt?: string;
  updatedAt?: string;
  history?: Array<{
    timestamp: string;
    action: string;
    message: string;
  }>;
  visitations?: Array<{
    id: string;
    scheduledAt?: string;
    note?: string;
    completedAt?: string;
    updatedAt?: string;
  }>;
};

type VisitationModalState = {
  action: "schedule" | "note" | "complete";
  pk: string;
  sk: string;
  memberName: string;
  visitationId?: string;
} | null;

type DeleteModalState = {
  pk: string;
  sk: string;
  memberName: string;
} | null;

type AnnouncementDeleteModalState = {
  sk: string;
  weekLabel: string;
} | null;

type AnnouncementItemDeleteModalState = {
  index: number;
  label: string;
} | null;

type EditingMemberState = {
  pk: string;
  sk: string;
  createdAt?: string;
} | null;

type SelectedMemberState = {
  pk: string;
  sk: string;
} | null;

type VisitationFocusState = {
  pk: string;
  sk: string;
  memberName: string;
} | null;

type AnnouncementWeekData = {
  weekLabel?: string;
  items?: string[];
  createdAt?: string;
  updatedAt?: string;
};

type AnnouncementWeekFormState = {
  sk?: string;
  createdAt?: string;
  weekLabel: string;
  items: string[];
};

type AnnouncementSortOrder = "latest" | "oldest";
type MemberSortOrder = "name-asc" | "name-desc";
type UserDirectoryItem = {
  username: string;
  email: string;
  enabled: boolean;
  status: string;
  groups: string[];
};

type UserDirectoryResponse = {
  message: string;
  time: string;
  groupOptions: string[];
  items: UserDirectoryItem[];
};

const manageableGroups = ["admin", "super_user", "regular_user"] as const;
const groupLabelMap: Record<(typeof manageableGroups)[number], string> = {
  admin: "Admin",
  super_user: "Super User",
  regular_user: "Regular User",
};

const congregationApiName = Object.keys(outputs.custom?.API ?? {})[0];
const initialMemberForm: MemberFormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  role: "",
  status: "",
  address: "",
  notes: "",
};

const parseMemberData = (value: string): StoredMemberData | null => {
  try {
    return JSON.parse(value) as StoredMemberData;
  } catch {
    return null;
  }
};

const formatMemberKeyLabel = (pk: string, sk: string) => `${pk} / ${sk}`;

const formatCompactMemberKey = (sk: string) => {
  return sk;
};

const normalizePhoneForLink = (value?: string) => {
  if (!value) {
    return "";
  }

  const cleaned = value.replace(/[^\d+]/g, "");

  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  return cleaned.replace(/[^\d]/g, "");
};

const getMemberInitials = (
  firstName?: string,
  lastName?: string,
  fallbackName?: string,
) => {
  const parts = [firstName, lastName]
    .filter(Boolean)
    .map((value) => value!.trim())
    .filter(Boolean);

  if (parts.length > 0) {
    return parts.slice(0, 2).map((value) => value[0]!.toUpperCase()).join("");
  }

  if (fallbackName?.trim()) {
    return fallbackName.trim()[0]!.toUpperCase();
  }

  return "?";
};

const parseAnnouncementWeekData = (value: string): AnnouncementWeekData | null => {
  try {
    return JSON.parse(value) as AnnouncementWeekData;
  } catch {
    return null;
  }
};

const formatAnnouncementWeekLabel = (value: string | undefined) => {
  if (!value) {
    return "Unknown week";
  }

  const match = /^(\d{4})-W(\d{2})$/.exec(value);

  if (!match) {
    return value;
  }

  const [, yearText, weekText] = match;
  const year = Number(yearText);
  const week = Number(weekText);
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const januaryFourthDay = januaryFourth.getUTCDay() || 7;
  const mondayOfWeekOne = new Date(januaryFourth);
  mondayOfWeekOne.setUTCDate(januaryFourth.getUTCDate() - januaryFourthDay + 1);
  const mondayOfTargetWeek = new Date(mondayOfWeekOne);
  mondayOfTargetWeek.setUTCDate(mondayOfWeekOne.getUTCDate() + (week - 1) * 7);

  return `Week of ${mondayOfTargetWeek.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })}`;
};

const extractGroupsFromClaim = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map(String);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map(String);
      }
    } catch {
      const cleaned = value.replace(/^\[|\]$/g, "").trim();

      return cleaned
        .split(/[,\s]+/)
        .map((group) => group.trim())
        .filter(Boolean);
    }

    return [value];
  }

  return [];
};

const placeholderPages: PageKey[] = [
  "events",
  "sunday-school",
  "summer-camp",
  "parking",
  "board-meeting",
];

const initialAnnouncementWeekForm: AnnouncementWeekFormState = {
  weekLabel: "",
  items: [""],
};

export default function App() {
  const sidePanelRef = useRef<HTMLElement | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [pendingSignInStep, setPendingSignInStep] = useState<string | null>(null);
  const [challengeResponse, setChallengeResponse] = useState("");
  const [authStatus, setAuthStatus] = useState<"checking" | "signed-in" | "signed-out">(
    "checking",
  );
  const [authForm, setAuthForm] = useState({
    username: "",
    password: "",
  });
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [currentUserLabel, setCurrentUserLabel] = useState<string>("");
  const [currentUserGroups, setCurrentUserGroups] = useState<string[]>([]);
  const [activePage, setActivePage] = useState<PageKey>("congregation");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [backendMessage, setBackendMessage] = useState<BackendMessage | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [isBackendLoading, setIsBackendLoading] = useState(false);
  const [announcements, setAnnouncements] = useState<AnnouncementResponse | null>(null);
  const [announcementsError, setAnnouncementsError] = useState<string | null>(null);
  const [isAnnouncementsLoading, setIsAnnouncementsLoading] = useState(false);
  const [announcementSortOrder, setAnnouncementSortOrder] =
    useState<AnnouncementSortOrder>("latest");
  const [announcementWeekForm, setAnnouncementWeekForm] =
    useState<AnnouncementWeekFormState>(initialAnnouncementWeekForm);
  const [announcementSubmitState, setAnnouncementSubmitState] = useState<string | null>(
    null,
  );
  const [isAnnouncementSubmitting, setIsAnnouncementSubmitting] = useState(false);
  const [deletingAnnouncementSk, setDeletingAnnouncementSk] = useState<string | null>(null);
  const [announcementDeleteModal, setAnnouncementDeleteModal] =
    useState<AnnouncementDeleteModalState>(null);
  const [announcementItemDeleteModal, setAnnouncementItemDeleteModal] =
    useState<AnnouncementItemDeleteModalState>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberSortOrder, setMemberSortOrder] = useState<MemberSortOrder>("name-asc");
  const [memberForm, setMemberForm] = useState<MemberFormState>(initialMemberForm);
  const [editingMember, setEditingMember] = useState<EditingMemberState>(null);
  const [selectedMember, setSelectedMember] = useState<SelectedMemberState>(null);
  const [visitationFocus, setVisitationFocus] = useState<VisitationFocusState>(null);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [memberSubmitState, setMemberSubmitState] = useState<string | null>(null);
  const [isMemberSubmitting, setIsMemberSubmitting] = useState(false);
  const [deletingMemberKey, setDeletingMemberKey] = useState<string | null>(null);
  const [visitationModal, setVisitationModal] = useState<VisitationModalState>(null);
  const [visitationSchedule, setVisitationSchedule] = useState("");
  const [visitationNote, setVisitationNote] = useState("");
  const [visitationSubmitState, setVisitationSubmitState] = useState<string | null>(
    null,
  );
  const [isVisitationSubmitting, setIsVisitationSubmitting] = useState(false);
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>(null);
  const [userDirectory, setUserDirectory] = useState<UserDirectoryItem[]>([]);
  const [groupAssignments, setGroupAssignments] = useState<Record<string, string[]>>({});
  const [isUserDirectoryLoading, setIsUserDirectoryLoading] = useState(false);
  const [userDirectoryError, setUserDirectoryError] = useState<string | null>(null);
  const [savingUserGroups, setSavingUserGroups] = useState<string | null>(null);
  const [userDirectoryStatus, setUserDirectoryStatus] = useState<string | null>(null);
  const currentPage = pageContent[activePage];
  const isEditingMember = editingMember !== null;
  const canManageUsers =
    currentUserGroups.includes("admin") || currentUserGroups.includes("super_user");
  const canManageAnnouncements = canManageUsers;
  const isBackendRequestInFlight =
    isBackendLoading ||
    isAnnouncementsLoading ||
    isAnnouncementSubmitting ||
    deletingAnnouncementSk !== null ||
    isMemberSubmitting ||
    deletingMemberKey !== null ||
    isVisitationSubmitting ||
    isUserDirectoryLoading ||
    savingUserGroups !== null;
  const selectedMemberItem =
    selectedMember && backendMessage
      ? backendMessage.items.find(
          (item) => item.pk === selectedMember.pk && item.sk === selectedMember.sk,
        ) ?? null
      : null;
  const selectedMemberData = selectedMemberItem
    ? parseMemberData(selectedMemberItem.data)
    : null;
  const selectedMemberName = selectedMemberData
    ? [selectedMemberData.firstName, selectedMemberData.lastName]
        .filter(Boolean)
        .join(" ") || "Unnamed member"
    : "Member";
  const selectedMemberPhone = normalizePhoneForLink(selectedMemberData?.phone);
  const selectedMemberWhatsappPhone = selectedMemberPhone.replace(/[^\d]/g, "");
  const selectedMemberHistory =
    selectedMemberData?.history && selectedMemberData.history.length > 0
      ? selectedMemberData.history
      : selectedMemberData?.createdAt
        ? [
            {
              timestamp: selectedMemberData.createdAt,
              action: "member_created",
              message: "Member entry added.",
            },
          ]
        : [];
  const normalizedMemberSearch = memberSearch.trim().toLowerCase();
  const filteredCongregationItems =
    backendMessage?.items.filter((item) => {
      if (!normalizedMemberSearch) {
        return true;
      }

      const memberData = parseMemberData(item.data);
      const haystack = [
        item.pk,
        item.sk,
        item.data,
        memberData?.firstName,
        memberData?.lastName,
        memberData?.email,
        memberData?.phone,
        memberData?.role,
        memberData?.status,
        memberData?.address,
        memberData?.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedMemberSearch);
    }) ?? [];
  const sortedCongregationItems = filteredCongregationItems.slice().sort((left, right) => {
    const leftData = parseMemberData(left.data);
    const rightData = parseMemberData(right.data);
    const leftName =
      [leftData?.firstName, leftData?.lastName].filter(Boolean).join(" ") ||
      `${left.pk} ${left.sk}`;
    const rightName =
      [rightData?.firstName, rightData?.lastName].filter(Boolean).join(" ") ||
      `${right.pk} ${right.sk}`;

    return memberSortOrder === "name-asc"
      ? leftName.localeCompare(rightName, undefined, { sensitivity: "base" })
      : rightName.localeCompare(leftName, undefined, { sensitivity: "base" });
  });
  const visitationItems = visitationFocus
    ? (backendMessage?.items.filter(
        (item) => item.pk === visitationFocus.pk && item.sk === visitationFocus.sk,
      ) ?? [])
    : (backendMessage?.items ?? []);
  const announcementWeeks =
    announcements?.items
      .slice()
      .sort((left, right) =>
        announcementSortOrder === "latest"
          ? right.sk.localeCompare(left.sk)
          : left.sk.localeCompare(right.sk),
      )
      .map((item) => ({
        ...item,
        parsed: parseAnnouncementWeekData(item.data),
      })) ?? [];

  const getAuthHeader = async () => {
    const session = await fetchAuthSession({ forceRefresh: true });
    const token =
      session.tokens?.accessToken?.toString() ?? session.tokens?.idToken?.toString();

    if (!token) {
      throw new Error("No auth token available.");
    }

    return token;
  };

  const authorizedGet = async <T,>(path: string) => {
    const authorization = await getAuthHeader();
    const restOperation = get({
      apiName: congregationApiName,
      path,
      options: {
        headers: {
          Authorization: authorization,
        },
      },
    });
    const { body } = await restOperation.response;
    return (await body.json()) as T;
  };

  const authorizedPost = async (path: string, body: unknown) => {
    const authorization = await getAuthHeader();
    const restOperation = post({
      apiName: congregationApiName,
      path,
      options: {
        headers: {
          Authorization: authorization,
        },
        body: body as never,
      },
    });

    return restOperation.response;
  };

  const checkAuthSession = async () => {
    try {
      const [user, session] = await Promise.all([
        getCurrentUser(),
        fetchAuthSession({ forceRefresh: true }),
      ]);
      const groups = Array.from(
        new Set([
          ...extractGroupsFromClaim(session.tokens?.idToken?.payload["cognito:groups"]),
          ...extractGroupsFromClaim(
            session.tokens?.accessToken?.payload["cognito:groups"],
          ),
        ]),
      );
      setCurrentUserLabel(user.signInDetails?.loginId ?? user.username);
      setCurrentUserGroups(groups);
      setAuthStatus("signed-in");
    } catch {
      setCurrentUserGroups([]);
      setAuthStatus("signed-out");
    }
  };

  const loadBackendMessage = async () => {
    if (!congregationApiName) {
      setBackendError(
        "Backend API is not configured yet. Run the Amplify sandbox and generate outputs.",
      );
      return;
    }

    setIsBackendLoading(true);
    setBackendError(null);

    try {
      const response = await authorizedGet<BackendMessage>("/congregation/message");
      setBackendMessage(response);
    } catch (error) {
      setBackendError("Unable to load the congregation backend message.");
    } finally {
      setIsBackendLoading(false);
    }
  };

  const loadAnnouncements = async () => {
    if (!congregationApiName) {
      setAnnouncementsError(
        "Backend API is not configured yet. Run the Amplify sandbox and generate outputs.",
      );
      return;
    }

    setIsAnnouncementsLoading(true);
    setAnnouncementsError(null);

    try {
      const response = await authorizedGet<AnnouncementResponse>("/announcements");
      setAnnouncements(response);
    } catch {
      setAnnouncementsError("Unable to load announcements.");
    } finally {
      setIsAnnouncementsLoading(false);
    }
  };

  const loadUserDirectory = async () => {
    if (!congregationApiName || !canManageUsers) {
      return;
    }

    setIsUserDirectoryLoading(true);
    setUserDirectoryError(null);

    try {
      const response = await authorizedGet<UserDirectoryResponse>("/admin/users");
      setUserDirectory(response.items);
      setGroupAssignments(
        Object.fromEntries(
          response.items.map((user) => [user.username, user.groups]),
        ),
      );
    } catch {
      setUserDirectoryError("Unable to load user access.");
    } finally {
      setIsUserDirectoryLoading(false);
    }
  };

  const toggleUserGroupAssignment = (username: string, groupName: (typeof manageableGroups)[number]) => {
    setGroupAssignments((current) => {
      const existingGroups = current[username] ?? [];
      const nextGroups = existingGroups.includes(groupName)
        ? existingGroups.filter((group) => group !== groupName)
        : [...existingGroups, groupName];

      return {
        ...current,
        [username]: nextGroups,
      };
    });
  };

  const handleSaveUserGroups = async (username: string) => {
    if (!canManageUsers || !congregationApiName) {
      return;
    }

    setSavingUserGroups(username);
    setUserDirectoryStatus(null);

    try {
      await authorizedPost("/admin/users/groups", {
        username,
        groups: groupAssignments[username] ?? [],
      });
      setUserDirectory((current) =>
        current.map((user) =>
          user.username === username
            ? { ...user, groups: groupAssignments[username] ?? [] }
            : user,
        ),
      );
      setUserDirectoryStatus(`Updated access for ${username}.`);
    } catch {
      setUserDirectoryStatus(`Unable to update access for ${username}.`);
    } finally {
      setSavingUserGroups(null);
    }
  };

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("shepherd-hub-theme");

    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("shepherd-hub-theme", theme);
  }, [theme]);

  useEffect(() => {
    void checkAuthSession();
  }, []);

  useEffect(() => {
    if (authStatus !== "signed-in") {
      return;
    }

    if (!congregationApiName) {
      setBackendError(
        "Backend API is not configured yet. Run the Amplify sandbox and generate outputs.",
      );
      return;
    }

    let isMounted = true;

    void (async () => {
      await loadBackendMessage();
      await loadAnnouncements();
      if (!isMounted) {
        return;
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [authStatus]);

  useEffect(() => {
    if (authStatus !== "signed-in" || activePage !== "user-access" || !canManageUsers) {
      return;
    }

    void loadUserDirectory();
  }, [activePage, authStatus, canManageUsers]);

  useEffect(() => {
    if (activePage === "user-access" && !canManageUsers) {
      setActivePage("congregation");
    }
  }, [activePage, canManageUsers]);

  useEffect(() => {
    if (activePage === "announcement-week" && !canManageAnnouncements) {
      setActivePage("announcements");
    }
  }, [activePage, canManageAnnouncements]);

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!sidePanelRef.current) {
        return;
      }

      const target = event.target;

      if (target instanceof Node && !sidePanelRef.current.contains(target)) {
        setIsMobileMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isMobileMenuOpen]);

  useEffect(() => {
    setIsHistoryExpanded(false);
  }, [selectedMember?.pk, selectedMember?.sk]);

  const updateMemberForm = (
    field: keyof MemberFormState,
    value: MemberFormState[keyof MemberFormState],
  ) => {
    setMemberForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateAnnouncementWeekField = (
    field: "weekLabel",
    value: string,
  ) => {
    setAnnouncementWeekForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateAnnouncementItem = (index: number, value: string) => {
    setAnnouncementWeekForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? value : item,
      ),
    }));
  };

  const addAnnouncementItem = () => {
    setAnnouncementWeekForm((current) => ({
      ...current,
      items: [...current.items, ""],
    }));
  };

  const removeAnnouncementItem = (index: number) => {
    setAnnouncementWeekForm((current) => {
      const nextItems = current.items.filter((_, itemIndex) => itemIndex !== index);

      return {
        ...current,
        items: nextItems.length > 0 ? nextItems : [""],
      };
    });
  };

  const openAnnouncementItemDeleteModal = (index: number, label: string) => {
    setAnnouncementItemDeleteModal({ index, label });
  };

  const closeAnnouncementItemDeleteModal = () => {
    setAnnouncementItemDeleteModal(null);
  };

  const confirmRemoveAnnouncementItem = () => {
    if (!announcementItemDeleteModal) {
      return;
    }

    removeAnnouncementItem(announcementItemDeleteModal.index);
    closeAnnouncementItemDeleteModal();
  };

  const startCreateAnnouncementWeek = () => {
    if (!canManageAnnouncements) {
      return;
    }
    setAnnouncementWeekForm(initialAnnouncementWeekForm);
    setAnnouncementSubmitState(null);
    setActivePage("announcement-week");
  };

  const startEditAnnouncementWeek = (
    sk: string,
    parsed: AnnouncementWeekData | null,
  ) => {
    if (!canManageAnnouncements) {
      return;
    }
    setAnnouncementWeekForm({
      sk,
      createdAt: parsed?.createdAt,
      weekLabel: parsed?.weekLabel ?? "",
      items: parsed?.items && parsed.items.length > 0 ? parsed.items : [""],
    });
    setAnnouncementSubmitState(null);
    setActivePage("announcement-week");
  };

  const handleAnnouncementWeekSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!congregationApiName) {
      setAnnouncementSubmitState("Backend API is not configured yet.");
      return;
    }

    const nextAnnouncementSk = `WEEK#${announcementWeekForm.weekLabel}`;
    const existingWeek = announcementWeeks.find((week) => week.sk === nextAnnouncementSk);

    if (existingWeek && announcementWeekForm.sk !== nextAnnouncementSk) {
      setAnnouncementSubmitState("That week already exists.");
      return;
    }

    setIsAnnouncementSubmitting(true);
    setAnnouncementSubmitState(null);

    try {
      await authorizedPost("/announcements/week", {
        ...(announcementWeekForm.sk ? { sk: announcementWeekForm.sk } : {}),
        ...(announcementWeekForm.createdAt
          ? { createdAt: announcementWeekForm.createdAt }
          : {}),
        weekLabel: announcementWeekForm.weekLabel,
        items: announcementWeekForm.items,
      });
      setAnnouncementSubmitState(
        announcementWeekForm.sk
          ? "Announcement week updated."
          : "Announcement week created.",
      );
      setAnnouncementWeekForm(initialAnnouncementWeekForm);
      await loadAnnouncements();
      setActivePage("announcements");
    } catch (error) {
      setAnnouncementSubmitState("Unable to save announcement week.");
    } finally {
      setIsAnnouncementSubmitting(false);
    }
  };

  const handleRemoveAnnouncementWeek = async (sk: string) => {
    if (!congregationApiName) {
      return;
    }

    setDeletingAnnouncementSk(sk);

    try {
      await authorizedPost("/announcements/week/remove", {
        pk: "ANNOUNCEMENT",
        sk,
      });
      await loadAnnouncements();
      if (announcementWeekForm.sk === sk) {
        setAnnouncementWeekForm(initialAnnouncementWeekForm);
        setAnnouncementSubmitState(null);
      }
    } finally {
      setDeletingAnnouncementSk(null);
    }
  };

  const openAnnouncementDeleteModal = (sk: string, weekLabel: string) => {
    setAnnouncementDeleteModal({ sk, weekLabel });
  };

  const closeAnnouncementDeleteModal = () => {
    setAnnouncementDeleteModal(null);
  };

  const confirmRemoveAnnouncementWeek = async () => {
    if (!announcementDeleteModal) {
      return;
    }

    await handleRemoveAnnouncementWeek(announcementDeleteModal.sk);
    closeAnnouncementDeleteModal();
  };

  const handleMemberSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!congregationApiName) {
      setMemberSubmitState("Backend API is not configured yet.");
      return;
    }

    setIsMemberSubmitting(true);
    setMemberSubmitState(null);

    try {
      const requestBody = editingMember
        ? {
            ...memberForm,
            pk: editingMember.pk,
            sk: editingMember.sk,
            ...(editingMember.createdAt
              ? { createdAt: editingMember.createdAt }
              : {}),
          }
        : memberForm;

      await authorizedPost(
        editingMember ? "/congregation/member/update" : "/congregation/member",
        requestBody,
      );
      setMemberSubmitState(editingMember ? "Member updated." : "Member saved.");
      setMemberForm(initialMemberForm);
      setEditingMember(null);
      await loadBackendMessage();
      setActivePage("congregation");
    } catch (error) {
      setMemberSubmitState(
        editingMember ? "Unable to update member." : "Unable to save member.",
      );
    } finally {
      setIsMemberSubmitting(false);
    }
  };

  const openNewMemberPage = () => {
    setEditingMember(null);
    setMemberForm(initialMemberForm);
    setMemberSubmitState(null);
    setActivePage("new-member");
  };

  const openEditMemberPage = (
    pk: string,
    sk: string,
    memberData: StoredMemberData | null,
  ) => {
    setEditingMember({
      pk,
      sk,
      createdAt: memberData?.createdAt,
    });
    setMemberForm({
      firstName: memberData?.firstName ?? "",
      lastName: memberData?.lastName ?? "",
      email: memberData?.email ?? "",
      phone: memberData?.phone ?? "",
      role: memberData?.role ?? "",
      status: memberData?.status ?? "",
      address: memberData?.address ?? "",
      notes: memberData?.notes ?? "",
    });
    setMemberSubmitState(null);
    setActivePage("new-member");
  };

  const handleCancelMemberForm = () => {
    setEditingMember(null);
    setMemberForm(initialMemberForm);
    setMemberSubmitState(null);
    setActivePage("congregation");
  };

  const openMemberDetailsPage = (pk: string, sk: string) => {
    setSelectedMember({ pk, sk });
    setActivePage("member-details");
  };

  const openMemberVisitationPage = (pk: string, sk: string, memberName: string) => {
    setSelectedMember({ pk, sk });
    setVisitationFocus({ pk, sk, memberName });
    setActivePage("visitation");
  };

  const handleDeleteMember = async (pk: string, sk: string) => {
    if (!congregationApiName) {
      return;
    }

    const memberKey = `${pk}-${sk}`;
    setDeletingMemberKey(memberKey);

    try {
      await authorizedPost("/congregation/member/remove", { pk, sk });
      await loadBackendMessage();
    } finally {
      setDeletingMemberKey(null);
    }
  };

  const openDeleteModal = (pk: string, sk: string, memberName: string) => {
    setDeleteModal({
      pk,
      sk,
      memberName,
    });
  };

  const closeDeleteModal = () => {
    setDeleteModal(null);
  };

  const confirmDeleteMember = async () => {
    if (!deleteModal) {
      return;
    }

    await handleDeleteMember(deleteModal.pk, deleteModal.sk);
    closeDeleteModal();
  };

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSigningIn(true);
    setAuthError(null);

    try {
      const result = await signIn({
        username: authForm.username,
        password: authForm.password,
      });

      if (result.nextStep.signInStep !== "DONE") {
        setPendingSignInStep(result.nextStep.signInStep);
        return;
      }

      setPendingSignInStep(null);
      setChallengeResponse("");
      await checkAuthSession();
    } catch {
      setAuthError("Unable to sign in with those credentials.");
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleConfirmSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSigningIn(true);
    setAuthError(null);

    try {
      const result = await confirmSignIn({
        challengeResponse,
      });

      if (result.nextStep.signInStep !== "DONE") {
        setPendingSignInStep(result.nextStep.signInStep);
        setAuthError(`Another sign-in step is required: ${result.nextStep.signInStep}.`);
        return;
      }

      setPendingSignInStep(null);
      setChallengeResponse("");
      await checkAuthSession();
    } catch {
      setAuthError("Unable to complete the sign-in challenge.");
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setAuthStatus("signed-out");
    setCurrentUserLabel("");
    setCurrentUserGroups([]);
    setBackendMessage(null);
    setBackendError(null);
    setUserDirectory([]);
    setGroupAssignments({});
    setUserDirectoryError(null);
    setUserDirectoryStatus(null);
  };

  const toggleTheme = () => {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  };

  const openVisitationModal = (
    action: NonNullable<VisitationModalState>["action"],
    pk: string,
    sk: string,
    memberName: string,
    options?: {
      visitationId?: string;
      schedule?: string;
      note?: string;
    },
  ) => {
    setVisitationModal({
      action,
      pk,
      sk,
      memberName,
      visitationId: options?.visitationId,
    });
    setVisitationSchedule(options?.schedule ?? "");
    setVisitationNote(options?.note ?? "");
    setVisitationSubmitState(null);
  };

  const closeVisitationModal = () => {
    setVisitationModal(null);
    setVisitationSchedule("");
    setVisitationNote("");
    setVisitationSubmitState(null);
  };

  const handleVisitationModalSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!visitationModal || !congregationApiName) {
      return;
    }

    setIsVisitationSubmitting(true);
    setVisitationSubmitState(null);

    try {
      const body: Record<string, string> = {
        pk: visitationModal.pk,
        sk: visitationModal.sk,
        action: visitationModal.action,
      };

      if (visitationModal.visitationId) {
        body.visitationId = visitationModal.visitationId;
      }

      if (visitationModal.action === "schedule") {
        body.schedule = visitationSchedule;
      }

      if (visitationModal.action === "note") {
        body.note = visitationNote;
      }

      await authorizedPost("/congregation/member/visitation", body);
      await loadBackendMessage();
      closeVisitationModal();
    } catch {
      setVisitationSubmitState("Unable to save visitation update.");
    } finally {
      setIsVisitationSubmitting(false);
    }
  };

  if (authStatus !== "signed-in") {
    const challengeLabel =
      pendingSignInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED"
        ? "New password"
        : pendingSignInStep === "CONFIRM_SIGN_IN_WITH_EMAIL_CODE"
          ? "Email verification code"
          : pendingSignInStep === "CONFIRM_SIGN_IN_WITH_SMS_CODE"
            ? "SMS verification code"
            : pendingSignInStep === "CONFIRM_SIGN_IN_WITH_TOTP_CODE"
              ? "Authenticator code"
              : "Challenge response";

    return (
      <div className="auth-shell" data-theme={theme}>
        <form
          className="auth-card"
          onSubmit={pendingSignInStep ? handleConfirmSignIn : handleSignIn}
        >
          <p className="eyebrow">Shepherd Hub</p>
          <h1 className="auth-title">Sign in to continue</h1>
          <p className="auth-copy">
            Use your Cognito username and password to access Shephed Hub.
          </p>

          {!pendingSignInStep ? (
            <>
              <label className="auth-field">
                <span>Username</span>
                <input
                  type="text"
                  value={authForm.username}
                  onChange={(event) =>
                    setAuthForm((current) => ({
                      ...current,
                      username: event.target.value,
                    }))
                  }
                  placeholder="Enter your username"
                />
              </label>

              <label className="auth-field">
                <span>Password</span>
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(event) =>
                    setAuthForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  placeholder="Enter your password"
                />
              </label>
            </>
          ) : (
            <>
              <label className="auth-field">
                <span>{challengeLabel}</span>
                <input
                  type={
                    pendingSignInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED"
                      ? "password"
                      : "text"
                  }
                  value={challengeResponse}
                  onChange={(event) => setChallengeResponse(event.target.value)}
                  placeholder={`Enter ${challengeLabel.toLowerCase()}`}
                />
              </label>
            </>
          )}

          {authError ? <p className="auth-error">{authError}</p> : null}

          <button
            type="submit"
            className="auth-submit-button"
            disabled={isSigningIn || authStatus === "checking"}
          >
            {authStatus === "checking" || isSigningIn
              ? "Signing in..."
              : pendingSignInStep
                ? "Continue Sign In"
                : "Sign In"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <aside className="side-panel" ref={sidePanelRef}>
        <div className="side-panel-header">
          <button
            type="button"
            className={`menu-toggle${isMobileMenuOpen ? " open" : ""}`}
            aria-expanded={isMobileMenuOpen}
            aria-controls="home-sections-nav"
            aria-label="Toggle navigation menu"
            onClick={() => setIsMobileMenuOpen((current) => !current)}
          >
            <span />
            <span />
            <span />
          </button>

          <div className="side-panel-brand">
            <p className="brand-kicker">Shepherd Hub</p>
            <p className="signed-in-user">{currentUserLabel}</p>
          </div>

          <img className="side-panel-logo" src="/logo.png" alt="Shepherd Hub logo" />
        </div>

        <nav
          id="home-sections-nav"
          className={`nav-list${isMobileMenuOpen ? " open" : ""}`}
          aria-label="Home sections"
        >
          {navSections
            .map((section) => ({
              ...section,
              items: section.items.filter(
                (item) => item.key !== "user-access" || canManageUsers,
              ),
            }))
            .filter((section) => section.items.length > 0)
            .map((section) => (
              <div className="nav-section" key={section.label}>
                <p className="nav-section-label">{section.label}</p>

                <div className="nav-section-items">
                  {section.items.map((item) => {
                    const isActive = item.key === activePage;

                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={`nav-item${isActive ? " active" : ""}`}
                        onClick={() => {
                          if (item.key !== "visitation") {
                            setVisitationFocus(null);
                          }
                          setActivePage(item.key);
                          setIsMobileMenuOpen(false);
                        }}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

          <div className="nav-section">
            <p className="nav-section-label">Session</p>
            <div className="nav-section-items">
              <button
                type="button"
                className="nav-item theme-toggle-button"
                onClick={toggleTheme}
              >
                {theme === "light" ? "Dark Mode" : "Light Mode"}
              </button>
              <button
                type="button"
                className="nav-item sign-out-button"
                onClick={handleSignOut}
              >
                Sign Out
              </button>
            </div>
          </div>
        </nav>
      </aside>

      <main className="content-panel">
        {isBackendRequestInFlight ? (
          <div className="page-progress" aria-live="polite" aria-label="Loading">
            <div className="page-progress-bar" />
          </div>
        ) : null}

        <section className="hero-card">
          <div className="hero-header">
            <div>
              <p className="eyebrow">{currentPage.eyebrow}</p>
              {currentPage.description ? (
                <p className="description">{currentPage.description}</p>
              ) : null}
            </div>

            {activePage === "congregation" ? (
              <button
                type="button"
                className="hero-action-button"
                onClick={openNewMemberPage}
              >
                Add Member
              </button>
            ) : activePage === "announcements" && canManageAnnouncements ? (
              <button
                type="button"
                className="hero-action-button"
                onClick={startCreateAnnouncementWeek}
              >
                Add Week
              </button>
            ) : null}
          </div>

          {activePage === "congregation" ? (
            <div className="api-message-card">
              <p className="api-message-label">Congregation</p>

              {!isBackendLoading && !backendError && backendMessage ? (
                <>
                  <div className="congregation-search-row">
                    <label className="congregation-search-shell">
                      <span className="congregation-search-icon" aria-hidden="true">
                        Search
                      </span>
                      <input
                        type="search"
                        className="congregation-search-input"
                        placeholder="Search members"
                        value={memberSearch}
                        onChange={(event) => setMemberSearch(event.target.value)}
                      />
                    </label>
                    <div className="congregation-search-tools">
                      <label className="congregation-sort-control">
                        <span className="congregation-sort-label">Sort</span>
                        <select
                          aria-label="Sort members by name"
                          value={memberSortOrder}
                          onChange={(event) =>
                            setMemberSortOrder(event.target.value as MemberSortOrder)
                          }
                        >
                          <option value="name-asc">A-Z</option>
                          <option value="name-desc">Z-A</option>
                        </select>
                      </label>
                      <p className="congregation-search-count">
                        {filteredCongregationItems.length} member
                        {filteredCongregationItems.length === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>

                  <div className="api-data-list">
                    {sortedCongregationItems.map((item) => {
                      const memberData = parseMemberData(item.data);
                      const fullName = [memberData?.firstName, memberData?.lastName]
                        .filter(Boolean)
                        .join(" ");
                      const memberLabel = fullName || formatMemberKeyLabel(item.pk, item.sk);
                      const memberInitials = getMemberInitials(
                        memberData?.firstName,
                        memberData?.lastName,
                        memberLabel,
                      );

                      return (
                        <article
                          className="api-data-item api-data-item-clickable"
                          key={`${item.pk}-${item.sk}`}
                        >
                          {memberData ? (
                            <div className="api-data-details">
                              <div
                                className="api-data-layout"
                                onClick={() => openMemberDetailsPage(item.pk, item.sk)}
                              >
                                <div className="api-data-avatar" aria-hidden="true">
                                  {memberInitials}
                                </div>

                                <div className="api-data-content">
                                  <div className="api-data-row">
                                    <div className="api-data-title-block">
                                      <p className="api-data-name">
                                        {fullName || "Unnamed member"}
                                      </p>
                                      <p
                                        className="api-data-key"
                                        title={formatMemberKeyLabel(item.pk, item.sk)}
                                      >
                                        <span className="api-data-key-full">
                                          {formatMemberKeyLabel(item.pk, item.sk)}
                                        </span>
                                        <span className="api-data-key-compact">
                                          {formatCompactMemberKey(item.sk)}
                                        </span>
                                      </p>
                                    </div>

                                  </div>

                                  <div className="api-data-meta">
                                    <span>{memberData.role || "No role"}</span>
                                    <span>{memberData.status || "No status"}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <p className="api-data-value">{item.data}</p>
                          )}
                        </article>
                      );
                    })}

                    {filteredCongregationItems.length === 0 ? (
                      <p className="congregation-empty-state">
                        No members match your search.
                      </p>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    className="mobile-fab-button"
                    onClick={openNewMemberPage}
                    aria-label="Add member"
                  >
                    +
                  </button>
                </>
              ) : null}
            </div>
          ) : null}

          {activePage === "visitation" ? (
            <div className="visitation-board">
              {visitationFocus ? (
                <div className="visitation-focus-banner">
                  <div>
                    <p className="visitation-focus-label">Focused Member</p>
                    <p className="visitation-focus-name">{visitationFocus.memberName}</p>
                  </div>
                  <div className="visitation-focus-actions">
                    <button
                      type="button"
                      className="member-cancel-button member-back-button"
                      onClick={() => {
                        setSelectedMember({
                          pk: visitationFocus.pk,
                          sk: visitationFocus.sk,
                        });
                        setActivePage("member-details");
                      }}
                      aria-label="Back to details"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      className="member-cancel-button"
                      onClick={() => setVisitationFocus(null)}
                    >
                      Show All
                    </button>
                  </div>
                </div>
              ) : null}

              {visitationItems.map((item) => {
                const memberData = parseMemberData(item.data);
                const fullName = [memberData?.firstName, memberData?.lastName]
                  .filter(Boolean)
                  .join(" ");
                const visits = memberData?.visitations ?? [];

                return (
                  <article className="visitation-card" key={`${item.pk}-${item.sk}`}>
                    <div className="visitation-card-top">
                      <div>
                        <p className="visitation-member-key">
                          {item.pk} / {item.sk}
                        </p>
                        <p className="visitation-member-name">
                          {fullName || "Unnamed member"}
                        </p>
                      </div>
                    </div>

                    <div className="visitation-actions">
                      <button
                        type="button"
                        className="visitation-action-button visitation-action-schedule"
                        onClick={() =>
                          openVisitationModal(
                            "schedule",
                            item.pk,
                            item.sk,
                            fullName || "Unnamed member",
                          )
                        }
                      >
                        <span>Schedule</span>
                      </button>
                    </div>

                    {visits.length > 0 ? (
                      <div className="visitation-summary">
                        {visits.map((visit, index) => (
                          <div className="visit-entry" key={visit.id}>
                            <div className="visit-entry-top">
                              <p className="visit-entry-label">Visit {visits.length - index}</p>
                              <p className="visit-entry-time">
                                {visit.scheduledAt
                                  ? new Date(visit.scheduledAt).toLocaleString()
                                  : "No schedule"}
                              </p>
                            </div>

                            <div className="visit-entry-meta">
                              <p className="visitation-summary-item">
                                Status: {visit.completedAt ? "Completed" : "Pending"}
                              </p>
                              <p className="visitation-summary-item">
                                Note: {visit.note || "No note yet"}
                              </p>
                            </div>

                            <div className="visit-entry-actions">
                              <button
                                type="button"
                                className="visitation-action-button visitation-action-schedule"
                                onClick={() =>
                                  openVisitationModal(
                                    "schedule",
                                    item.pk,
                                    item.sk,
                                    fullName || "Unnamed member",
                                    {
                                      visitationId: visit.id,
                                      schedule: visit.scheduledAt,
                                    },
                                  )
                                }
                              >
                                <span>Edit Visit</span>
                              </button>

                              <button
                                type="button"
                                className={`visitation-action-button visitation-action-note${
                                  visit.note ? " active" : ""
                                }`}
                                onClick={() =>
                                  openVisitationModal(
                                    "note",
                                    item.pk,
                                    item.sk,
                                    fullName || "Unnamed member",
                                    {
                                      visitationId: visit.id,
                                      note: visit.note,
                                    },
                                  )
                                }
                              >
                                <span>{visit.note ? "Edit Note" : "Add Note"}</span>
                              </button>

                              <button
                                type="button"
                                className={`visitation-action-button visitation-action-complete${
                                  visit.completedAt ? " active" : ""
                                }`}
                                onClick={() =>
                                  openVisitationModal(
                                    "complete",
                                    item.pk,
                                    item.sk,
                                    fullName || "Unnamed member",
                                    {
                                      visitationId: visit.id,
                                    },
                                  )
                                }
                              >
                                <span>{visit.completedAt ? "Completed" : "Mark Done"}</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="visitation-empty">No visitations scheduled yet.</p>
                    )}
                  </article>
                );
              })}
            </div>
          ) : null}

          {activePage === "new-member" ? (
            <form className="member-form-card" onSubmit={handleMemberSubmit}>
              <div className="member-form-header">
                <p className="member-form-mode">
                  {isEditingMember ? "Edit" : "Add Member"}
                </p>
              </div>

              <div className="member-form-grid">
                <label className="member-field">
                  <span>First name</span>
                  <input
                    type="text"
                    placeholder="John"
                    value={memberForm.firstName}
                    onChange={(event) =>
                      updateMemberForm("firstName", event.target.value)
                    }
                  />
                </label>

                <label className="member-field">
                  <span>Last name</span>
                  <input
                    type="text"
                    placeholder="Smith"
                    value={memberForm.lastName}
                    onChange={(event) =>
                      updateMemberForm("lastName", event.target.value)
                    }
                  />
                </label>

                <label className="member-field">
                  <span>Email</span>
                  <input
                    type="email"
                    placeholder="john@example.com"
                    value={memberForm.email}
                    onChange={(event) =>
                      updateMemberForm("email", event.target.value)
                    }
                  />
                </label>

                <label className="member-field">
                  <span>Phone</span>
                  <input
                    type="tel"
                    placeholder="+1 (555) 555-5555"
                    value={memberForm.phone}
                    onChange={(event) =>
                      updateMemberForm("phone", event.target.value)
                    }
                  />
                </label>

                <label className="member-field">
                  <span>Role</span>
                  <select
                    value={memberForm.role}
                    onChange={(event) => updateMemberForm("role", event.target.value)}
                  >
                    <option value="" disabled>
                      Select a role
                    </option>
                    <option>Priest</option>
                    <option>Member</option>
                    <option>Servant</option>
                    <option>Visitor</option>
                    <option>Sector coordinator</option>
                    <option>Contractor</option>
                    <option>Student</option>
                  </select>
                </label>

                <label className="member-field">
                  <span>Status</span>
                  <select
                    value={memberForm.status}
                    onChange={(event) =>
                      updateMemberForm("status", event.target.value)
                    }
                  >
                    <option value="" disabled>
                      Select a status
                    </option>
                    <option>Active</option>
                    <option>Needs Follow-up</option>
                    <option>Inactive</option>
                  </select>
                </label>

                <label className="member-field member-field-full">
                  <span>Address</span>
                  <input
                    type="text"
                    placeholder="123 Main Street"
                    value={memberForm.address}
                    onChange={(event) =>
                      updateMemberForm("address", event.target.value)
                    }
                  />
                </label>

                <label className="member-field member-field-full">
                  <span>Notes</span>
                  <textarea
                    rows={4}
                    placeholder="Assignment notes, visitation reminders, or special circumstances"
                    value={memberForm.notes}
                    onChange={(event) =>
                      updateMemberForm("notes", event.target.value)
                    }
                  />
                </label>
              </div>

              <div className="member-form-actions">
                {memberSubmitState ? (
                  <p className="member-submit-message">{memberSubmitState}</p>
                ) : null}
                <button
                  type="button"
                  className="member-cancel-button"
                  onClick={handleCancelMemberForm}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="member-submit-button"
                  disabled={isMemberSubmitting}
                >
                  {isMemberSubmitting
                    ? isEditingMember
                      ? "Updating..."
                      : "Saving..."
                    : isEditingMember
                      ? "Update Member"
                      : "Save Member"}
                </button>
              </div>
            </form>
          ) : null}

          {activePage === "announcement-week" ? (
            <div className="announcements-editor-page">
              <form className="announcements-editor-card" onSubmit={handleAnnouncementWeekSubmit}>
                <div className="member-form-header">
                  <p className="member-form-mode">
                    {announcementWeekForm.sk ? "Edit Week" : "Add Week"}
                  </p>
                </div>

                <div className="member-form-grid">
                  <label className="member-field member-field-full">
                    <span>Week</span>
                    <input
                      type="week"
                      value={announcementWeekForm.weekLabel}
                      onChange={(event) =>
                        updateAnnouncementWeekField("weekLabel", event.target.value)
                      }
                    />
                  </label>

                  <div className="member-field member-field-full">
                    <span>Announcements</span>
                    <div className="announcement-items-list">
                      {announcementWeekForm.items.map((item, index) => (
                        <div className="announcement-item-row" key={index}>
                          <input
                            type="text"
                            placeholder={`Announcement ${index + 1}`}
                            value={item}
                            onChange={(event) =>
                              updateAnnouncementItem(index, event.target.value)
                            }
                          />
                          <button
                            type="button"
                            className="announcement-remove-button"
                            onClick={() =>
                              openAnnouncementItemDeleteModal(
                                index,
                                item || `Announcement ${index + 1}`,
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="announcement-add-button"
                      onClick={addAnnouncementItem}
                    >
                      Add Item
                    </button>
                  </div>
                </div>

                <div className="member-form-actions">
                  {announcementSubmitState ? (
                    <p className="member-submit-message">{announcementSubmitState}</p>
                  ) : null}
                  <button
                    type="button"
                    className="member-cancel-button"
                    onClick={() => {
                      setAnnouncementSubmitState(null);
                      setActivePage("announcements");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="member-submit-button"
                    disabled={isAnnouncementSubmitting}
                  >
                    {isAnnouncementSubmitting
                      ? "Saving..."
                      : announcementWeekForm.sk
                        ? "Update Week"
                        : "Create Week"}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {activePage === "announcements" ? (
            <div className="announcements-page">
              <div className="announcements-list-card">
                <div className="announcement-list-toolbar">
                  <p className="api-message-label">Weekly Announcements</p>
                  <label className="announcement-sort-control">
                    <span>Sort by date</span>
                    <select
                      value={announcementSortOrder}
                      onChange={(event) =>
                        setAnnouncementSortOrder(
                          event.target.value as AnnouncementSortOrder,
                        )
                      }
                    >
                      <option value="latest">Latest first</option>
                      <option value="oldest">Oldest first</option>
                    </select>
                  </label>
                </div>
                {isAnnouncementsLoading ? (
                  <p className="api-message-text">Loading announcement weeks...</p>
                ) : announcementsError ? (
                  <p className="api-message-text">{announcementsError}</p>
                ) : announcementWeeks.length === 0 ? (
                  <p className="api-message-text">No announcement weeks yet.</p>
                ) : (
                  <div className="announcement-weeks-list">
                    {announcementWeeks.map((week) => (
                      <article className="announcement-week-card" key={week.sk}>
                        <div className="announcement-week-header">
                          <div>
                            <p className="announcement-week-title">
                              {formatAnnouncementWeekLabel(week.parsed?.weekLabel)}
                            </p>
                            <p className="announcement-week-meta">{week.sk}</p>
                          </div>
                          {canManageAnnouncements ? (
                            <div className="announcement-week-actions">
                              <button
                                type="button"
                                className="announcement-edit-button"
                                onClick={() =>
                                  startEditAnnouncementWeek(week.sk, week.parsed)
                                }
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="api-delete-button"
                                onClick={() =>
                                  openAnnouncementDeleteModal(
                                    week.sk,
                                    formatAnnouncementWeekLabel(week.parsed?.weekLabel),
                                  )
                                }
                                disabled={deletingAnnouncementSk === week.sk}
                              >
                                {deletingAnnouncementSk === week.sk ? "..." : "Delete"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <ul className="announcement-week-items">
                          {(week.parsed?.items ?? []).map((item, index) => (
                            <li key={`${week.sk}-${index}`}>{item}</li>
                          ))}
                        </ul>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {activePage === "user-access" ? (
            <div className="user-access-page">
              <div className="user-access-card">
                <div className="user-access-header">
                  <p className="api-message-label">Assign User Groups</p>
                  <p className="congregation-search-count">
                    {userDirectory.length} user{userDirectory.length === 1 ? "" : "s"}
                  </p>
                </div>

                {userDirectoryStatus ? (
                  <p className="member-submit-message">{userDirectoryStatus}</p>
                ) : null}

                {isUserDirectoryLoading ? (
                  <p className="api-message-text">Loading users...</p>
                ) : userDirectoryError ? (
                  <p className="api-message-text">{userDirectoryError}</p>
                ) : userDirectory.length === 0 ? (
                  <p className="api-message-text">No Cognito users found.</p>
                ) : (
                  <div className="user-access-list">
                    {userDirectory.map((user) => {
                      const assignedGroups = groupAssignments[user.username] ?? user.groups;

                      return (
                        <article className="user-access-item" key={user.username}>
                          <div className="user-access-top">
                            <div>
                              <p className="user-access-username">{user.username}</p>
                              <p className="user-access-meta">
                                {user.email || "No email"} · {user.status} ·{" "}
                                {user.enabled ? "Enabled" : "Disabled"}
                              </p>
                            </div>
                            <button
                              type="button"
                              className="member-submit-button"
                              onClick={() => handleSaveUserGroups(user.username)}
                              disabled={savingUserGroups === user.username}
                            >
                              {savingUserGroups === user.username ? "Saving..." : "Save"}
                            </button>
                          </div>

                          <div className="user-access-groups">
                            {manageableGroups.map((groupName) => (
                              <label className="user-access-group" key={groupName}>
                                <input
                                  type="checkbox"
                                  checked={assignedGroups.includes(groupName)}
                                  onChange={() =>
                                    toggleUserGroupAssignment(user.username, groupName)
                                  }
                                />
                                <span>{groupLabelMap[groupName]}</span>
                              </label>
                            ))}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {placeholderPages.includes(activePage) ? (
            <div className="placeholder-page-card">
              <p className="placeholder-page-kicker">Placeholder</p>
              <p className="placeholder-page-copy">
                This page is ready for future content and workflow details.
              </p>
            </div>
          ) : null}

          {activePage === "member-details" ? (
            <div className="member-detail-card">
              {selectedMemberItem && selectedMemberData ? (
                <>
                  <div className="member-detail-header">
                    <div>
                      <p className="member-detail-key">
                        {selectedMemberItem.pk} / {selectedMemberItem.sk}
                      </p>
                      <h2 className="member-detail-name">{selectedMemberName}</h2>
                    </div>

                    <div className="member-detail-actions">
                      <div className="member-detail-action-groups">
                        <div className="member-detail-action-row member-detail-action-row-primary">
                          <button
                            type="button"
                            className="member-cancel-button member-back-button"
                            onClick={() => setActivePage("congregation")}
                            aria-label="Back to congregation"
                          >
                            ←
                          </button>
                          <button
                            type="button"
                            className="api-visitations-button"
                            onClick={() =>
                              openMemberVisitationPage(
                                selectedMemberItem.pk,
                                selectedMemberItem.sk,
                                selectedMemberName,
                              )
                            }
                          >
                            Visitations
                          </button>
                          <div className="member-detail-contact-actions">
                            <a
                              className={`member-contact-button phone${
                                selectedMemberPhone ? "" : " disabled"
                              }`}
                              href={selectedMemberPhone ? `tel:${selectedMemberPhone}` : undefined}
                              aria-label="Call member"
                              onClick={(event) => {
                                if (!selectedMemberPhone) {
                                  event.preventDefault();
                                }
                              }}
                            >
                              <img
                                src="/phone-ios.png"
                                alt=""
                                aria-hidden="true"
                                className="member-contact-image"
                              />
                            </a>
                            <a
                              className={`member-contact-button imessage${
                                selectedMemberPhone ? "" : " disabled"
                              }`}
                              href={selectedMemberPhone ? `sms:${selectedMemberPhone}` : undefined}
                              aria-label="Message member"
                              onClick={(event) => {
                                if (!selectedMemberPhone) {
                                  event.preventDefault();
                                }
                              }}
                            >
                              <img
                                src="/imessage.png"
                                alt=""
                                aria-hidden="true"
                                className="member-contact-image"
                              />
                            </a>
                            <a
                              className={`member-contact-button whatsapp${
                                selectedMemberWhatsappPhone ? "" : " disabled"
                              }`}
                              href={
                                selectedMemberWhatsappPhone
                                  ? `https://wa.me/${selectedMemberWhatsappPhone}`
                                  : undefined
                              }
                              target="_blank"
                              rel="noreferrer"
                              aria-label="Open WhatsApp"
                              onClick={(event) => {
                                if (!selectedMemberWhatsappPhone) {
                                  event.preventDefault();
                                }
                              }}
                            >
                              <img
                                src="/whatsapp.png"
                                alt=""
                                aria-hidden="true"
                                className="member-contact-image"
                              />
                            </a>
                          </div>
                        </div>
                        <div className="member-detail-action-row member-detail-action-row-secondary">
                          <button
                            type="button"
                            className="member-submit-button"
                            onClick={() =>
                              openEditMemberPage(
                                selectedMemberItem.pk,
                                selectedMemberItem.sk,
                                selectedMemberData,
                              )
                            }
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="api-delete-button"
                            onClick={() =>
                              openDeleteModal(
                                selectedMemberItem.pk,
                                selectedMemberItem.sk,
                                selectedMemberName,
                              )
                            }
                            disabled={
                              deletingMemberKey ===
                              `${selectedMemberItem.pk}-${selectedMemberItem.sk}`
                            }
                          >
                            {deletingMemberKey ===
                            `${selectedMemberItem.pk}-${selectedMemberItem.sk}`
                              ? "Deleting..."
                              : "Delete"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="member-detail-grid">
                    <div className="member-detail-section">
                      <p className="member-detail-label">Role</p>
                      <p className="member-detail-value">
                        {selectedMemberData.role || "Not set"}
                      </p>
                    </div>
                    <div className="member-detail-section">
                      <p className="member-detail-label">Status</p>
                      <p className="member-detail-value">
                        {selectedMemberData.status || "Not set"}
                      </p>
                    </div>
                    <div className="member-detail-section">
                      <p className="member-detail-label">Email</p>
                      <p className="member-detail-value">
                        {selectedMemberData.email || "Not set"}
                      </p>
                    </div>
                    <div className="member-detail-section">
                      <p className="member-detail-label">Phone</p>
                      <p className="member-detail-value">
                        {selectedMemberData.phone || "Not set"}
                      </p>
                    </div>
                    <div className="member-detail-section member-detail-section-full">
                      <p className="member-detail-label">Address</p>
                      <p className="member-detail-value">
                        {selectedMemberData.address || "Not set"}
                      </p>
                    </div>
                    <div className="member-detail-section member-detail-section-full">
                      <p className="member-detail-label">Notes</p>
                      <p className="member-detail-value">
                        {selectedMemberData.notes || "No notes yet"}
                      </p>
                    </div>
                  </div>

                  <div className="member-detail-history-card">
                    <button
                      type="button"
                      className="member-history-toggle"
                      onClick={() => setIsHistoryExpanded((current) => !current)}
                    >
                      <span className="member-detail-subtitle">Log History</span>
                      <span className="member-history-toggle-icon">
                        {isHistoryExpanded ? "Hide" : "Show"}
                      </span>
                    </button>

                    {isHistoryExpanded ? (
                      selectedMemberHistory.length > 0 ? (
                        <div className="member-history-list">
                          {selectedMemberHistory.map((entry, index) => (
                            <div
                              className="member-history-item"
                              key={`${entry.action}-${entry.timestamp}-${index}`}
                            >
                              <div className="member-history-top">
                                <p className="member-history-action">
                                  {entry.action
                                    .split("_")
                                    .join(" ")
                                    .replace(/\b\w/g, (match: string) =>
                                      match.toUpperCase(),
                                    )}
                                </p>
                                <p className="member-history-time">
                                  {new Date(entry.timestamp).toLocaleString()}
                                </p>
                              </div>
                              <p className="member-history-message">{entry.message}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="member-detail-value">
                          No activity has been recorded yet.
                        </p>
                      )
                    ) : null}
                  </div>

                  <div className="member-detail-visit-card">
                    <p className="member-detail-subtitle">Visitation</p>
                    {selectedMemberData.visitations && selectedMemberData.visitations.length > 0 ? (
                      <div className="member-visit-list">
                        {selectedMemberData.visitations.map((visit, index) => (
                          <div className="member-visit-item" key={visit.id}>
                            <div className="member-visit-top">
                              <p className="member-detail-label">Visit {selectedMemberData.visitations!.length - index}</p>
                              <p className="member-history-time">
                                {visit.scheduledAt
                                  ? new Date(visit.scheduledAt).toLocaleString()
                                  : "No schedule"}
                              </p>
                            </div>
                            <div className="member-detail-grid">
                              <div className="member-detail-section">
                                <p className="member-detail-label">Status</p>
                                <p className="member-detail-value">
                                  {visit.completedAt ? "Completed" : "Pending"}
                                </p>
                              </div>
                              <div className="member-detail-section">
                                <p className="member-detail-label">Completed At</p>
                                <p className="member-detail-value">
                                  {visit.completedAt
                                    ? new Date(visit.completedAt).toLocaleString()
                                    : "Not completed"}
                                </p>
                              </div>
                              <div className="member-detail-section member-detail-section-full">
                                <p className="member-detail-label">Note</p>
                                <p className="member-detail-value">
                                  {visit.note || "No note yet"}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="member-detail-value">No visitations scheduled yet.</p>
                    )}
                  </div>
                </>
              ) : (
                <div className="member-detail-empty">
                  <p className="member-detail-value">
                    The selected member could not be found.
                  </p>
                  <button
                    type="button"
                    className="member-cancel-button"
                    onClick={() => setActivePage("congregation")}
                  >
                    Back to Congregation
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </section>
      </main>

      {visitationModal ? (
        <div className="modal-overlay" role="presentation" onClick={closeVisitationModal}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Visitation action"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">{visitationModal.memberName}</p>
            <h2 className="modal-title">
              {visitationModal.action === "schedule"
                ? visitationModal.visitationId
                  ? "Edit visitation"
                  : "Schedule visitation"
                : visitationModal.action === "note"
                  ? "Add visitation note"
                  : "Mark visitation done"}
            </h2>

            <form className="modal-form" onSubmit={handleVisitationModalSubmit}>
              {visitationModal.action === "schedule" ? (
                <label className="member-field">
                  <span>Visitation date</span>
                  <input
                    type="datetime-local"
                    value={visitationSchedule}
                    onChange={(event) => setVisitationSchedule(event.target.value)}
                    required
                  />
                </label>
              ) : null}

              {visitationModal.action === "note" ? (
                <label className="member-field">
                  <span>Visitation note</span>
                  <textarea
                    rows={5}
                    value={visitationNote}
                    onChange={(event) => setVisitationNote(event.target.value)}
                    placeholder="Add a summary of the visit or planned follow-up"
                    required
                  />
                </label>
              ) : null}

              {visitationModal.action === "complete" ? (
                <p className="modal-copy">
                  Confirm that this specific visit for {visitationModal.memberName} has
                  been completed.
                </p>
              ) : null}

              <div className="modal-actions">
                {visitationSubmitState ? (
                  <p className="modal-submit-message">{visitationSubmitState}</p>
                ) : null}
                <button
                  type="button"
                  className="modal-secondary-button"
                  onClick={closeVisitationModal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="member-submit-button"
                  disabled={isVisitationSubmitting}
                >
                  {isVisitationSubmitting
                    ? "Saving..."
                    : visitationModal.action === "complete"
                      ? "Confirm"
                      : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteModal ? (
        <div className="modal-overlay" role="presentation" onClick={closeDeleteModal}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Delete member confirmation"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">Delete Member</p>
            <h2 className="modal-title">{deleteModal.memberName}</h2>
            <p className="modal-copy">
              Remove this member from the congregation list? This action cannot be
              undone.
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="modal-secondary-button"
                onClick={closeDeleteModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-danger-button"
                onClick={confirmDeleteMember}
                disabled={deletingMemberKey === `${deleteModal.pk}-${deleteModal.sk}`}
              >
                {deletingMemberKey === `${deleteModal.pk}-${deleteModal.sk}`
                  ? "Deleting..."
                  : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {announcementDeleteModal ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={closeAnnouncementDeleteModal}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Delete announcement week confirmation"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">Delete Week</p>
            <h2 className="modal-title">{announcementDeleteModal.weekLabel}</h2>
            <p className="modal-copy">
              Remove this announcement week and its full list of items? This action
              cannot be undone.
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="modal-secondary-button"
                onClick={closeAnnouncementDeleteModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-danger-button"
                onClick={confirmRemoveAnnouncementWeek}
                disabled={deletingAnnouncementSk === announcementDeleteModal.sk}
              >
                {deletingAnnouncementSk === announcementDeleteModal.sk
                  ? "Deleting..."
                  : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {announcementItemDeleteModal ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={closeAnnouncementItemDeleteModal}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Delete announcement item confirmation"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">Remove Announcement</p>
            <h2 className="modal-title">{announcementItemDeleteModal.label}</h2>
            <p className="modal-copy">
              Remove this announcement from the current week list?
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="modal-secondary-button"
                onClick={closeAnnouncementItemDeleteModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-danger-button"
                onClick={confirmRemoveAnnouncementItem}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
