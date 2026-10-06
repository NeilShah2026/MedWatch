export const staticCopy = {
  draftBanner: 'DRAFT — requires attorney review',
  privacy: {
    title: 'Privacy policy',
    sections: [
      {
        heading: 'What this is',
        body: 'This is a placeholder privacy policy for a demonstration build of MedWatch. It is not a legal document and must be replaced after review by an attorney before any real person’s information is entered.',
      },
      {
        heading: 'Information MedWatch stores',
        body: 'Client names, birthdates, medicine lists, dose records, daily check-ins, and notes entered by the care team. In this demo, all of it is synthetic.',
      },
      {
        heading: 'Who can see it',
        body: 'Only people at the client’s home health agency who are part of their care: the assigned nurses, agency administrators, linked caregivers, and the client.',
      },
      {
        heading: 'How it is protected',
        body: 'Access rules are enforced by the database for every request. Views and exports of records are written to an audit log that cannot be changed.',
      },
      {
        heading: 'AI features',
        body: 'When enabled, an AI model helps choose and word daily check-in questions. It receives only medicine names and types and an age range, never names, birthdates, contact details, notes or answers.',
      },
    ],
  },
  terms: {
    title: 'Terms of use',
    sections: [
      {
        heading: 'Demonstration only',
        body: 'This build of MedWatch is for demonstration with synthetic data. It is not for clinical use.',
      },
      {
        heading: 'Not medical advice',
        body: 'MedWatch shows prompts for clinicians to review. It does not give medical advice and does not replace the judgment of a licensed clinician.',
      },
      {
        heading: 'Your responsibilities',
        body: 'Keep your password private, sign out on shared devices, and contact your agency if you think your account was used by someone else.',
      },
    ],
  },
  about: {
    title: 'About the flags',
    intro:
      'MedWatch looks for patterns that a nurse may want to look at more closely. Each one is called a flag. A flag is a prompt for clinician review. It is not medical advice and it does not mean anything is wrong.',
    sections: [
      {
        heading: 'Symptom after a medicine change',
        body: 'When a new or stronger symptom appears within two weeks of a medicine being started or changed, MedWatch notes the timing, whether doses were reported taken, and whether that symptom is listed for that type of medicine.',
      },
      {
        heading: 'Medicine risk',
        body: 'Some kinds of medicines can deserve a closer look for older adults. MedWatch lets the nurse know when one is on the list.',
      },
      {
        heading: 'Medicine combination',
        body: 'Some kinds of medicines can add up when taken together. MedWatch lets the nurse know when both are on the list.',
      },
      {
        heading: 'Missed doses',
        body: 'When several doses in a row are reported missed, or fewer than 7 in 10 doses were reported taken over a week, the nurse is told so they can check in.',
      },
      {
        heading: 'What happens next',
        body: 'A nurse reviews each flag. They may acknowledge it, dismiss it with a reason, or escalate it to the wider care team. Please keep taking medicines as your care team has directed, and call them with any questions.',
      },
    ],
    rulesNote: 'The rules MedWatch uses are early examples that still need review by clinicians.',
  },
};
