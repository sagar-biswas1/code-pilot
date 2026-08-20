import open from "open";

import { apiClient } from "./apiClient";
import { getErrorMessage } from "./httpErrors";

export async function openUpgradeCheckout() {
  const response = await apiClient.billing.checkout.$post();

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  const { url } = await response.json();
  await open(url);
  return
}

export async function openBillingPortal() {
    const response = await apiClient.billing.portal.$post();
  
    if (!response.ok) {
      throw new Error(await getErrorMessage(response));
    }
  
    const { url } = await response.json();
    await open(url);
    return
  }
  