// Sample data used only in demo mode (see firebase-config.js) so the design can be previewed
// before a real Firebase project is wired up. None of this is persisted anywhere.

export const DEMO_OWNER = {
  displayName: "You",
  role: "owner",
  public: true,
  partnerUid: "demo-partner",
  travelBufferMinutes: 60,
  weekly: {
    sun: [],
    mon: [{ start: "22:00", end: "06:00", endNextDay: true, label: "Night shift" }],
    tue: [{ start: "22:00", end: "06:00", endNextDay: true, label: "Night shift" }],
    wed: [{ start: "22:00", end: "06:00", endNextDay: true, label: "Night shift" }],
    thu: [{ start: "22:00", end: "06:00", endNextDay: true, label: "Night shift" }],
    fri: [{ start: "22:00", end: "06:00", endNextDay: true, label: "Night shift" }],
    sat: [],
  },
  overrides: [],
};

export const DEMO_PARTNER = {
  displayName: "Girlfriend",
  role: "partner",
  public: false,
  partnerUid: "demo-owner",
  travelBufferMinutes: 60,
  weekly: {
    sun: [],
    mon: [{ start: "09:00", end: "17:30" }],
    tue: [{ start: "09:00", end: "17:30" }],
    wed: [{ start: "09:00", end: "17:30" }],
    thu: [{ start: "09:00", end: "17:30" }],
    fri: [{ start: "09:00", end: "17:30" }],
    sat: [],
  },
  overrides: [],
};

export const DEMO_REQUESTS = [
  {
    id: "demo-1",
    name: "Sam (friend)",
    contact: "sam@example.com",
    note: "Coffee before your shift?",
    date: new Date().toISOString().slice(0, 10),
    start: "18:00",
    end: "19:00",
    status: "pending",
  },
];
