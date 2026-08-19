export type LandmarkSeedRow = {
  id: string;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  aliases: string[];
  stopIds: string[];
  active: true;
  evidenceUrl: string;
  reviewedAt: Date;
};

export interface LandmarkSeedStore {
  replaceReviewedLandmarks(rows: LandmarkSeedRow[]): Promise<void>;
}

const reviewedAt = new Date("2026-08-20T00:00:00.000Z");

type ReviewedLandmark = Omit<
  LandmarkSeedRow,
  "active" | "reviewedAt" | "stopIds"
>;

const reviewed: ReviewedLandmark[] = [
  {
    id: "fishermans-wharf",
    name: "Fisherman’s Wharf",
    description: "Fisherman’s Wharf destination point.",
    latitude: 37.808,
    longitude: -122.4177,
    aliases: ["Fisherman Wharf", "The Wharf"],
    evidenceUrl: "https://www.sftravel.com/neighborhoods/fishermans-wharf",
  },
  {
    id: "pier-39",
    name: "Pier 39",
    description: "Pier 39 destination point.",
    latitude: 37.8087,
    longitude: -122.4098,
    aliases: ["PIER 39"],
    evidenceUrl: "https://www.pier39.com/",
  },
  {
    id: "union-square",
    name: "Union Square",
    description: "Union Square destination point.",
    latitude: 37.7879,
    longitude: -122.4075,
    aliases: ["Union Square San Francisco"],
    evidenceUrl: "https://www.visitunionsquaresf.com/",
  },
  {
    id: "ferry-building",
    name: "Ferry Building",
    description: "Ferry Building destination point.",
    latitude: 37.7955,
    longitude: -122.3937,
    aliases: ["Ferry Building Marketplace"],
    evidenceUrl: "https://www.ferrybuildingmarketplace.com/",
  },
  {
    id: "chinatown",
    name: "Chinatown",
    description: "Chinatown destination point.",
    latitude: 37.7941,
    longitude: -122.4078,
    aliases: ["San Francisco Chinatown"],
    evidenceUrl: "https://www.sftravel.com/neighborhoods/chinatown",
  },
  {
    id: "moscone-center",
    name: "Moscone Center",
    description: "Moscone Center destination point.",
    latitude: 37.784,
    longitude: -122.4014,
    aliases: ["Moscone"],
    evidenceUrl: "https://www.moscone.com/",
  },
  {
    id: "oracle-park",
    name: "Oracle Park",
    description: "Oracle Park destination point.",
    latitude: 37.7786,
    longitude: -122.3893,
    aliases: ["Giants ballpark"],
    evidenceUrl: "https://www.mlb.com/giants/ballpark",
  },
  {
    id: "chase-center",
    name: "Chase Center",
    description: "Chase Center destination point.",
    latitude: 37.768,
    longitude: -122.3875,
    aliases: ["Warriors arena"],
    evidenceUrl: "https://www.chasecenter.com/",
  },
  {
    id: "civic-center",
    name: "Civic Center",
    description: "Civic Center destination point.",
    latitude: 37.7793,
    longitude: -122.4193,
    aliases: ["Civic Center Plaza"],
    evidenceUrl: "https://www.sftravel.com/neighborhoods/civic-center",
  },
  {
    id: "city-hall",
    name: "City Hall",
    description: "City Hall destination point.",
    latitude: 37.7793,
    longitude: -122.4192,
    aliases: ["San Francisco City Hall"],
    evidenceUrl: "https://www.sf.gov/location/san-francisco-city-hall",
  },
  {
    id: "salesforce-transit-center",
    name: "Salesforce Transit Center",
    description: "Salesforce Transit Center destination point.",
    latitude: 37.7897,
    longitude: -122.3961,
    aliases: ["Transbay Transit Center"],
    evidenceUrl: "https://salesforcetransitcenter.com/",
  },
  {
    id: "golden-gate-park",
    name: "Golden Gate Park",
    description: "Golden Gate Park destination point.",
    latitude: 37.7694,
    longitude: -122.4862,
    aliases: ["GGP"],
    evidenceUrl: "https://sfrecpark.org/770/Golden-Gate-Park",
  },
  {
    id: "ocean-beach",
    name: "Ocean Beach",
    description: "Ocean Beach destination point.",
    latitude: 37.7593,
    longitude: -122.5107,
    aliases: ["Ocean Beach San Francisco"],
    evidenceUrl: "https://www.nps.gov/goga/planyourvisit/oceanbeach.htm",
  },
  {
    id: "presidio",
    name: "Presidio",
    description: "Presidio destination point.",
    latitude: 37.7989,
    longitude: -122.4662,
    aliases: ["The Presidio"],
    evidenceUrl: "https://presidio.gov/",
  },
  {
    id: "exploratorium",
    name: "Exploratorium",
    description: "Exploratorium destination point.",
    latitude: 37.8017,
    longitude: -122.3973,
    aliases: [],
    evidenceUrl: "https://www.exploratorium.edu/visit",
  },
  {
    id: "de-young-museum",
    name: "de Young Museum",
    description: "de Young Museum destination point.",
    latitude: 37.7715,
    longitude: -122.4687,
    aliases: ["de Young"],
    evidenceUrl: "https://www.famsf.org/visit/de-young",
  },
  {
    id: "california-academy-of-sciences",
    name: "California Academy of Sciences",
    description: "California Academy of Sciences destination point.",
    latitude: 37.7699,
    longitude: -122.4661,
    aliases: ["Cal Academy"],
    evidenceUrl: "https://www.calacademy.org/",
  },
  {
    id: "castro",
    name: "Castro",
    description: "Castro destination point.",
    latitude: 37.7609,
    longitude: -122.435,
    aliases: ["Castro District"],
    evidenceUrl: "https://www.sftravel.com/neighborhoods/castro-noe-valley",
  },
  {
    id: "japantown",
    name: "Japantown",
    description: "Japantown destination point.",
    latitude: 37.7854,
    longitude: -122.4296,
    aliases: ["Japan Center"],
    evidenceUrl: "https://www.sftravel.com/neighborhoods/japantown",
  },
  {
    id: "ucsf-parnassus",
    name: "UCSF Parnassus",
    description: "UCSF Parnassus destination point.",
    latitude: 37.7631,
    longitude: -122.4586,
    aliases: ["UCSF Medical Center at Parnassus"],
    evidenceUrl: "https://www.ucsfhealth.org/locations/parnassus-heights",
  },
  {
    id: "ucsf-mission-bay",
    name: "UCSF Mission Bay",
    description: "UCSF Mission Bay destination point.",
    latitude: 37.7665,
    longitude: -122.3897,
    aliases: ["UCSF Mission Bay campus"],
    evidenceUrl: "https://www.ucsfhealth.org/locations/mission-bay",
  },
  {
    id: "zuckerberg-san-francisco-general",
    name: "Zuckerberg San Francisco General",
    description: "Zuckerberg San Francisco General destination point.",
    latitude: 37.7557,
    longitude: -122.405,
    aliases: ["SF General", "Zuckerberg General Hospital"],
    evidenceUrl: "https://www.zuckerbergsanfranciscogeneral.org/",
  },
  {
    id: "kaiser-geary",
    name: "Kaiser Geary",
    description: "Kaiser Geary destination point.",
    latitude: 37.7824,
    longitude: -122.4427,
    aliases: ["Kaiser Permanente Geary"],
    evidenceUrl:
      "https://healthy.kaiserpermanente.org/northern-california/facilities/san-francisco-medical-center-100312",
  },
  {
    id: "fort-mason",
    name: "Fort Mason",
    description: "Fort Mason destination point.",
    latitude: 37.8068,
    longitude: -122.4311,
    aliases: ["Fort Mason Center"],
    evidenceUrl: "https://fortmason.org/",
  },
];

function freshReviewedLandmarks(): LandmarkSeedRow[] {
  return reviewed.map((landmark) => ({
    ...landmark,
    aliases: [...landmark.aliases],
    stopIds: [],
    active: true,
    reviewedAt: new Date(reviewedAt),
  }));
}

export const REVIEWED_TRANSIT_LANDMARKS: readonly LandmarkSeedRow[] =
  Object.freeze(
    freshReviewedLandmarks().map((row) =>
      Object.freeze({
        ...row,
        aliases: Object.freeze([...row.aliases]) as unknown as string[],
        stopIds: Object.freeze([...row.stopIds]) as unknown as string[],
      }),
    ),
  );

function isSafe(row: LandmarkSeedRow) {
  let url: URL;
  try {
    url = new URL(row.evidenceUrl);
  } catch {
    return false;
  }
  return (
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id) &&
    row.name.length > 0 &&
    row.name.length <= 120 &&
    row.description.length > 0 &&
    row.description.length <= 240 &&
    !/[<>\u0000-\u001f\u007f]/u.test(
      `${row.name}${row.description}${row.aliases.join("")}`,
    ) &&
    row.aliases.every((alias) => alias.length > 0 && alias.length <= 100) &&
    row.stopIds.length === 0 &&
    Number.isFinite(row.latitude) &&
    Number.isFinite(row.longitude) &&
    row.latitude >= 37.6 &&
    row.latitude <= 37.95 &&
    row.longitude >= -122.65 &&
    row.longitude <= -122.25 &&
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    url.search === "" &&
    url.hash === ""
  );
}

export async function seedTransitLandmarks(store: LandmarkSeedStore) {
  const rows = freshReviewedLandmarks();
  if (
    rows.length !== 24 ||
    new Set(rows.map((row) => row.id)).size !== 24 ||
    !rows.every(isSafe)
  ) {
    throw new Error("Reviewed transit landmarks are invalid.");
  }
  await store.replaceReviewedLandmarks(
    rows.map((row) => ({
      ...row,
      aliases: [...row.aliases],
      stopIds: [...row.stopIds],
      reviewedAt: new Date(row.reviewedAt),
    })),
  );
}
