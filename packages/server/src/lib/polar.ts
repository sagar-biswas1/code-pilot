import { Polar } from "@polar-sh/sdk";

type PolarServer = "sandbox" | "production";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is not set`);
  }
  return value;
}

export function getPolarAccessToken() {
  return getRequiredEnv("POLAR_ACCESS_TOKEN");
}

export function getPolarProductId() {
  return getRequiredEnv("POLAR_PRODUCT_ID");
}

export function getPolarServer() {
  return getRequiredEnv("POLAR_SERVER") as PolarServer;
}

export function getPolarCreditsMeterId() {
  return getRequiredEnv("POLAR_CREDITS_METER_ID");
}

const polar = new Polar({
  accessToken: getPolarAccessToken(),
  server: getPolarServer(),
});

function hasStatusCode(error: unknown): error is { statusCode: number } {
  return error instanceof Error && "statusCode" in error;
}

type CreateCheckoutUrlParams = {
  customerExternalID: string;
  requestUrl: string;
};
export async function createCheckoutUrl({
  customerExternalID,
  requestUrl,
}: CreateCheckoutUrlParams) {
  const result = await polar.checkouts.create({
    products: [getPolarProductId()],
    successUrl: new URL(`/billing/success`, requestUrl).toString(),
    externalCustomerId: customerExternalID,
    metadata: {
      source: "codepilot",
    },
  });
  return result.url;
}

export async function createCustomerPortalUrl({
  customerExternalID,
  requestUrl,
}: CreateCheckoutUrlParams) {
  const result = await polar.customerSessions.create({
    externalCustomerId: customerExternalID,
    returnUrl: new URL(`/billing/success`, requestUrl).toString(),
  });
  return result.customerPortalUrl;
}

export async function getAvailableCreditsBalance(customerExternalID: string) {
  try {
    const customerState = await polar.customers.getStateExternal({
      externalId: customerExternalID,
    });
    const matchingMeters = customerState.activeMeters.filter(
      (meter) => meter.meterId === getPolarCreditsMeterId(),
    );
    if (matchingMeters.length === 0) {
      throw new Error("Credits meter not found");
    }
    const creditsMeter = matchingMeters[0];
    return creditsMeter?.balance || 0;
  } catch (error) {
    if (hasStatusCode(error) && error.statusCode === 404) {
      return 0;
    }
    throw error;
  }
}

type IngestAiUsagesParams = {
    customerExternalID:string;
    eventId:string;
    credits:number;
   
}
export async function ingestAiUsages({
    customerExternalID,
    eventId,
    credits,
  
}:IngestAiUsagesParams){
    if(credits<=0){
        return
    }

    await polar.events.ingest({
        events:[{
            name:"codepilot_usages",
            externalId:eventId,
            externalCustomerId:customerExternalID,
            metadata:{
                credits
            }
        }]
    })
}

export default polar;
