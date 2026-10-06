export const caregiverCopy = {
  peopleTitle: 'My people',
  peopleSubtitle: 'People you help care for.',
  none: 'No one is linked to your account yet.',
  noneBody: 'Ask the home health agency to link you to the person you care for.',
  dosesToday: (done: number, total: number) =>
    total ? `Medicines today: ${done} of ${total}` : 'No medicines due today',
  checkinDone: 'Check-in done today',
  checkinNotDone: 'No check-in yet today',
  openFlags: (n: number) =>
    n === 1 ? '1 item for the nurse to review' : `${n} items for the nurse to review`,
  noFlags: 'Nothing waiting for review',
  open: 'Open',
  tabs: {
    today: 'Today',
    checkin: 'Check-in',
    medicines: 'Medicines',
    flags: 'Flags',
    summary: 'Summary',
  },
  flagsIntro: 'These are notes for the nurse to look at. They are not medical advice.',
  noAccess: 'You do not have access to this person.',
  missedAlertsTitle: 'Missed doses',
  missedAlert: (name: string, when: string) =>
    `${name}: a dose due ${when} has not been confirmed.`,
};
