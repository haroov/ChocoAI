export enum OrganisationRegion {
  USA = 'US',
  Israel = 'IL',
}

export type GuidestarOrganisation = {
  lastNihulTakinReportURLdirectDownload: string;
  lastDescriptiveReportURLdirectDownload: string;
  lastFinancialReportURLdirectDownload: string;
  govCertURLdirectDownload: string;
  urlGuidestar: string;
  hasGovSupports3Years: boolean;
  hasGovServices3Years: boolean;
  activityAreas: string[];
  lastNihulTakinReportDate: string;
  employeesNum: number;
  volunteersNum: number;
  isDeficitYear: string;
  isYearDeficit: boolean;
  turnover: number;
  establishedDate: string;
  addressZipCode: string;
  addressCity: string;
  addressHouseNum: string;
  addressStreet: string;
  fullAddress: string;
  ceoName: string;
  regulationType: string;
  email: string;
  hasNihulTakinForNextYear: boolean;
  lastFinancialReportURL: string;
  lastFinancialReportYear: string;
  lastDescriptiveReportURL: string;
  lastDescriptiveReportYear: string;
  govCertURL: string;
  orgGoal: string;
  branchCount: number;
  volunteerProjectId: unknown;
  secondaryClassificationsNums: string[];
  secondaryClassifications: string[];
  primaryClassificationsNums: string[];
  primaryClassifications: string[];
  orgYearFounded: number;
  malkarStatus: string;
  malkarType: string;
  hasReportsLast2Years: boolean;
  hasSubmittedPapers: boolean;
  hasNihulTakin: boolean;
  regNum: string;
  lastModifiedDate: string;
  approval46: boolean;
  fullName: string;
  name: string;
}

export type USAOrganisation = {
  zip: string;
  tax_period: number;
  subsection: number;
  street: string;
  status: number;
  state: string;
  sort_name: null,
  ruling: number;
  revenue_amt: number;
  pf_filing_req_cd: number;
  organization: number;
  ntee_cd: string;
  name: string;
  income_cd: number;
  income_amt: number;
  ico: string;
  group: number;
  foundation: number;
  filing_req_cd: number;
  ein: string;
  deductibility: number;
  classification: number;
  city: string;
  asset_cd: number;
  asset_amt: number;
  affiliation: number;
  activity: number;
  acct_pd: number;
}
