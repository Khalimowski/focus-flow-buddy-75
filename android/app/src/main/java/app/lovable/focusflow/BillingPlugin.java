package app.lovable.focusflow;

import android.app.Activity;
import android.util.Log;

import androidx.annotation.NonNull;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryProductDetailsResult;
import com.android.billingclient.api.QueryPurchasesParams;
import com.android.billingclient.api.UnfetchedProduct;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Google Play Billing bridge for the premium unlock (ad-free + browser access).
 *
 * Premium sells two ways, and this plugin has to speak to Play differently for
 * each: the one-time unlock is an INAPP product, the monthly plan is a SUBS
 * product. Every entry point therefore carries a productType, and subscriptions
 * additionally need an *offer token* (which base plan / offer is being bought)
 * that INAPP purchases have no equivalent of.
 *
 * The JS side (src/lib/billing.ts) treats this as request/response, but Play's
 * purchase result arrives asynchronously on PurchasesUpdatedListener rather
 * than as a return value — so purchase() parks its PluginCall and the listener
 * resolves it.
 *
 * Purchases are acknowledged here. Play automatically refunds any purchase left
 * unacknowledged for three days, so this must happen even if the web layer
 * never gets around to reading the result.
 */
@CapacitorPlugin(name = "Billing")
public class BillingPlugin extends Plugin implements PurchasesUpdatedListener {

    private static final String TAG = "BillingPlugin";

    private BillingClient billingClient;
    /**
     * The in-flight purchase() call, resolved from onPurchasesUpdated. Written
     * from the Play callback thread and read from the WebView thread, hence
     * volatile, and always taken via {@link #takePendingPurchaseCall()} so two
     * paths can never resolve the same call twice.
     */
    private volatile PluginCall pendingPurchaseCall;

    /** Atomically claims the parked call, leaving nothing behind for a second caller. */
    private synchronized PluginCall takePendingPurchaseCall() {
        PluginCall call = pendingPurchaseCall;
        pendingPurchaseCall = null;
        return call;
    }

    /** Claims the purchase slot, or returns false if one is already in flight. */
    private synchronized boolean claimPurchaseSlot(PluginCall call) {
        if (pendingPurchaseCall != null) return false;
        pendingPurchaseCall = call;
        return true;
    }

    private interface ConnectionCallback {
        void onReady();

        void onError(String message);
    }

    @Override
    public void load() {
        // Pending purchases are enabled for one-time products only. The monthly
        // plan is auto-renewing, which needs nothing here; a *prepaid* base plan
        // would additionally need enablePrepaidPlans(), so keep the base plan in
        // Play Console auto-renewing or this will refuse to launch checkout.
        billingClient = BillingClient.newBuilder(getContext())
                .setListener(this)
                .enablePendingPurchases(
                        PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .build();
    }

    /**
     * Runs the action once the billing service is connected. Play drops the
     * connection whenever the Play Store app updates, so every entry point goes
     * through here rather than assuming a live client.
     */
    private void withConnection(final ConnectionCallback callback) {
        if (billingClient == null) {
            callback.onError("Billing client not initialized");
            return;
        }
        if (billingClient.isReady()) {
            callback.onReady();
            return;
        }
        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(@NonNull BillingResult billingResult) {
                if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    callback.onReady();
                } else {
                    callback.onError("Billing setup failed: " + billingResult.getDebugMessage());
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                // Nothing to do: the next call reconnects. Failing the current
                // call here would double-resolve when setup already reported.
                Log.i(TAG, "Billing service disconnected");
            }
        });
    }

    @PluginMethod
    public void isAvailable(final PluginCall call) {
        withConnection(new ConnectionCallback() {
            @Override
            public void onReady() {
                JSObject ret = new JSObject();
                ret.put("available", true);
                call.resolve(ret);
            }

            @Override
            public void onError(String message) {
                Log.i(TAG, "Billing unavailable: " + message);
                JSObject ret = new JSObject();
                ret.put("available", false);
                call.resolve(ret);
            }
        });
    }

    /**
     * Normalizes the productType the JS side asks for. Anything that isn't
     * explicitly "subs" is treated as a one-time product, which keeps a caller
     * that omits the field behaving exactly as it did before subscriptions.
     */
    private static String productType(PluginCall call) {
        String requested = call.getString("productType");
        return BillingClient.ProductType.SUBS.equals(requested)
                ? BillingClient.ProductType.SUBS
                : BillingClient.ProductType.INAPP;
    }

    /**
     * options: { productId, productType?, basePlanId? }
     * -> { productId, productType, title, description, price, billingPeriod }
     */
    @PluginMethod
    public void getProduct(final PluginCall call) {
        final String productId = call.getString("productId");
        if (productId == null) {
            call.reject("productId is required");
            return;
        }
        final String type = productType(call);
        final String basePlanId = call.getString("basePlanId");
        withConnection(new ConnectionCallback() {
            @Override
            public void onReady() {
                queryProduct(productId, type, new ProductCallback() {
                    @Override
                    public void onProduct(ProductDetails details) {
                        JSObject ret = new JSObject();
                        ret.put("productId", details.getProductId());
                        ret.put("productType", type);
                        ret.put("title", details.getTitle());
                        ret.put("description", details.getDescription());
                        if (BillingClient.ProductType.SUBS.equals(type)) {
                            ProductDetails.SubscriptionOfferDetails offer =
                                    selectOffer(details, basePlanId);
                            ProductDetails.PricingPhase phase = recurringPhase(offer);
                            ret.put("price", phase != null ? phase.getFormattedPrice() : "");
                            ret.put("billingPeriod", phase != null ? phase.getBillingPeriod() : "");
                        } else {
                            ProductDetails.OneTimePurchaseOfferDetails offer =
                                    details.getOneTimePurchaseOfferDetails();
                            ret.put("price", offer != null ? offer.getFormattedPrice() : "");
                            ret.put("billingPeriod", "");
                        }
                        call.resolve(ret);
                    }

                    @Override
                    public void onError(String message) {
                        call.reject(message);
                    }
                });
            }

            @Override
            public void onError(String message) {
                call.reject(message);
            }
        });
    }

    /**
     * The offer to buy and to quote a price from. Prefers the requested base
     * plan when the caller named one; otherwise takes the first Play returned.
     * Returns null when the product carries no offers at all, which Play only
     * does for a subscription with no active base plan.
     */
    private static ProductDetails.SubscriptionOfferDetails selectOffer(
            ProductDetails details, String basePlanId) {
        List<ProductDetails.SubscriptionOfferDetails> offers =
                details.getSubscriptionOfferDetails();
        if (offers == null || offers.isEmpty()) return null;
        if (basePlanId != null) {
            for (ProductDetails.SubscriptionOfferDetails offer : offers) {
                if (basePlanId.equals(offer.getBasePlanId())) return offer;
            }
        }
        return offers.get(0);
    }

    /**
     * The phase whose price the customer keeps paying. An offer with a free
     * trial or an intro price lists those phases first, so the *last* one is
     * the standing rate — the honest number to show next to "per month".
     */
    private static ProductDetails.PricingPhase recurringPhase(
            ProductDetails.SubscriptionOfferDetails offer) {
        if (offer == null) return null;
        List<ProductDetails.PricingPhase> phases =
                offer.getPricingPhases().getPricingPhaseList();
        if (phases == null || phases.isEmpty()) return null;
        return phases.get(phases.size() - 1);
    }

    private interface ProductCallback {
        void onProduct(ProductDetails details);

        void onError(String message);
    }

    private void queryProduct(String productId, String type, final ProductCallback callback) {
        QueryProductDetailsParams.Product product = QueryProductDetailsParams.Product.newBuilder()
                .setProductId(productId)
                .setProductType(type)
                .build();
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(product))
                .build();

        // Billing Library 8 changed this callback: the second argument is a
        // QueryProductDetailsResult rather than a bare List<ProductDetails>.
        billingClient.queryProductDetailsAsync(params, (billingResult, queryResult) -> {
            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                callback.onError("Product query failed: " + billingResult.getDebugMessage());
                return;
            }
            List<ProductDetails> productDetailsList = queryResult.getProductDetailsList();
            if (productDetailsList == null || productDetailsList.isEmpty()) {
                // Almost always a configuration problem: the product id isn't
                // active in Play Console, or this build isn't signed with the
                // uploaded key / isn't on a test track.
                callback.onError("Product not found in Play Console: " + productId
                        + " (" + type + ")" + unfetchedDetail(queryResult));
                return;
            }
            callback.onProduct(productDetailsList.get(0));
        });
    }

    /**
     * Library 8+ also reports the products Play refused to return, each with a
     * status code for why. Appending it keeps the "not found" message from
     * hiding the difference between a wrong id and a product Play won't offer
     * to this account.
     */
    private static String unfetchedDetail(QueryProductDetailsResult queryResult) {
        List<UnfetchedProduct> unfetched = queryResult.getUnfetchedProductList();
        if (unfetched == null || unfetched.isEmpty()) return "";
        StringBuilder detail = new StringBuilder(" (Play status");
        for (UnfetchedProduct product : unfetched) {
            detail.append(' ').append(product.getStatusCode());
        }
        return detail.append(')').toString();
    }

    /**
     * options: { productId, productType?, basePlanId? }
     * -> resolved later from onPurchasesUpdated
     */
    @PluginMethod
    public void purchase(final PluginCall call) {
        final String productId = call.getString("productId");
        if (productId == null) {
            call.reject("productId is required");
            return;
        }
        final String type = productType(call);
        final String basePlanId = call.getString("basePlanId");
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity available to host the purchase flow");
            return;
        }
        // Claim the slot up front. Checking here but assigning after the async
        // connect+query left a window where two quick taps both got through and
        // the first call was orphaned (kept alive, never resolved).
        if (!claimPurchaseSlot(call)) {
            call.reject("A purchase is already in progress");
            return;
        }
        call.setKeepAlive(true);

        withConnection(new ConnectionCallback() {
            @Override
            public void onReady() {
                queryProduct(productId, type, new ProductCallback() {
                    @Override
                    public void onProduct(ProductDetails details) {
                        BillingFlowParams.ProductDetailsParams.Builder productBuilder =
                                BillingFlowParams.ProductDetailsParams.newBuilder()
                                        .setProductDetails(details);
                        if (BillingClient.ProductType.SUBS.equals(type)) {
                            // Subscriptions must say which offer is being bought,
                            // and the token is only valid for the details object
                            // it came from — so it is resolved from this query
                            // rather than passed in from JS.
                            ProductDetails.SubscriptionOfferDetails offer =
                                    selectOffer(details, basePlanId);
                            if (offer == null) {
                                failPurchase(call, "No base plan is active for " + productId);
                                return;
                            }
                            productBuilder.setOfferToken(offer.getOfferToken());
                        }
                        BillingFlowParams flowParams = BillingFlowParams.newBuilder()
                                .setProductDetailsParamsList(
                                        Collections.singletonList(productBuilder.build()))
                                .build();

                        // The call is already parked (and kept alive): Play can
                        // call back before launchBillingFlow even returns.
                        BillingResult result =
                                billingClient.launchBillingFlow(activity, flowParams);
                        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                            failPurchase(call, "Could not open Play checkout: "
                                    + result.getDebugMessage());
                        }
                    }

                    @Override
                    public void onError(String message) {
                        failPurchase(call, message);
                    }
                });
            }

            @Override
            public void onError(String message) {
                failPurchase(call, message);
            }
        });
    }

    /**
     * Reject a purchase() call and free the slot. Every early-exit path must go
     * through here — leaving the slot occupied locks out every later purchase
     * attempt for the lifetime of the process.
     */
    private void failPurchase(PluginCall call, String message) {
        // Only the winner of the race with onPurchasesUpdated may settle the
        // call — otherwise a launch error arriving after Play already reported
        // success would reject a call that was resolved a moment earlier.
        if (takePendingPurchaseCall() == null) return;
        call.setKeepAlive(false);
        call.reject(message);
    }

    @Override
    public void onPurchasesUpdated(@NonNull BillingResult billingResult, List<Purchase> purchases) {
        PluginCall call = takePendingPurchaseCall();

        // Acknowledge regardless of whether anyone is listening — an
        // unacknowledged purchase is auto-refunded by Play after three days.
        if (purchases != null) {
            for (Purchase purchase : purchases) {
                acknowledgeIfNeeded(purchase);
            }
        }

        if (call == null) return;
        call.setKeepAlive(false);

        int code = billingResult.getResponseCode();
        if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
            JSObject ret = new JSObject();
            ret.put("purchases", new JSArray());
            ret.put("userCancelled", true);
            call.resolve(ret);
            return;
        }
        if (code != BillingClient.BillingResponseCode.OK) {
            call.reject("Purchase failed: " + billingResult.getDebugMessage());
            return;
        }

        JSArray array = new JSArray();
        appendPurchases(array, purchases, productType(call));
        JSObject ret = new JSObject();
        ret.put("purchases", array);
        ret.put("userCancelled", false);
        call.resolve(ret);
    }

    /**
     * -> { purchases: [...] } for everything Play currently attributes to this
     * account, across both product types.
     *
     * Play keeps one-time purchases and subscriptions in separate queries, and
     * a customer may hold either. Both are asked for and the results merged, so
     * the JS side sees one list and doesn't have to know how Play splits them.
     * A subscription only appears here while Play still considers it live
     * (including its grace period), which is what makes an ended plan quietly
     * drop out of the list.
     */
    @PluginMethod
    public void restore(final PluginCall call) {
        withConnection(new ConnectionCallback() {
            @Override
            public void onReady() {
                queryPurchases(BillingClient.ProductType.INAPP, new PurchasesCallback() {
                    @Override
                    public void onPurchases(List<Purchase> oneTime) {
                        queryPurchases(BillingClient.ProductType.SUBS, new PurchasesCallback() {
                            @Override
                            public void onPurchases(List<Purchase> subscriptions) {
                                JSArray array = new JSArray();
                                appendPurchases(array, oneTime, BillingClient.ProductType.INAPP);
                                appendPurchases(array, subscriptions, BillingClient.ProductType.SUBS);
                                JSObject ret = new JSObject();
                                ret.put("purchases", array);
                                call.resolve(ret);
                            }

                            @Override
                            public void onError(String message) {
                                call.reject(message);
                            }
                        });
                    }

                    @Override
                    public void onError(String message) {
                        call.reject(message);
                    }
                });
            }

            @Override
            public void onError(String message) {
                call.reject(message);
            }
        });
    }

    private interface PurchasesCallback {
        void onPurchases(List<Purchase> purchases);

        void onError(String message);
    }

    /** One product type's purchases, acknowledged on the way through. */
    private void queryPurchases(String type, final PurchasesCallback callback) {
        QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
                .setProductType(type)
                .build();
        billingClient.queryPurchasesAsync(params, (billingResult, purchases) -> {
            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                callback.onError("Purchase query failed: " + billingResult.getDebugMessage());
                return;
            }
            for (Purchase purchase : purchases) {
                acknowledgeIfNeeded(purchase);
            }
            callback.onPurchases(purchases != null ? purchases : new ArrayList<>());
        });
    }

    private void acknowledgeIfNeeded(Purchase purchase) {
        if (purchase.getPurchaseState() != Purchase.PurchaseState.PURCHASED) return;
        if (purchase.isAcknowledged()) return;

        AcknowledgePurchaseParams params = AcknowledgePurchaseParams.newBuilder()
                .setPurchaseToken(purchase.getPurchaseToken())
                .build();
        billingClient.acknowledgePurchase(params, billingResult -> {
            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                Log.w(TAG, "Acknowledge failed: " + billingResult.getDebugMessage());
            }
        });
    }

    /**
     * Appends Play's purchases to `array`. `type` is the product type they were
     * queried under, or null when the caller can't know it (the purchase
     * listener hears about both); the JS side keys the entitlement off the
     * product id either way, so it stays optional.
     */
    private void appendPurchases(JSArray array, List<Purchase> purchases, String type) {
        if (purchases == null) return;
        for (Purchase purchase : purchases) {
            // A purchase can cover several products; the entitlement is keyed
            // by product id on the JS side, so emit one entry per product.
            for (String productId : purchase.getProducts()) {
                JSObject item = new JSObject();
                item.put("productId", productId);
                if (type != null) item.put("productType", type);
                item.put("purchaseToken", purchase.getPurchaseToken());
                item.put("orderId", purchase.getOrderId());
                item.put("state", purchase.getPurchaseState());
                item.put("acknowledged", purchase.isAcknowledged());
                array.put(item);
            }
        }
    }

    @Override
    protected void handleOnDestroy() {
        // A purchase still parked here would leave the JS promise pending
        // forever; reject it so the UI can leave its "busy" state.
        PluginCall pending = takePendingPurchaseCall();
        if (pending != null) {
            pending.setKeepAlive(false);
            pending.reject("Purchase flow interrupted");
        }
        if (billingClient != null) {
            billingClient.endConnection();
            billingClient = null;
        }
        super.handleOnDestroy();
    }
}
