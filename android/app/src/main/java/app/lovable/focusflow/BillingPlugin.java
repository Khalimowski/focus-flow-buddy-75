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
import com.android.billingclient.api.QueryPurchasesParams;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Collections;
import java.util.List;

/**
 * Google Play Billing bridge for the premium unlock (ad-free + browser access).
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

    /** options: { productId } -> { productId, title, description, price } */
    @PluginMethod
    public void getProduct(final PluginCall call) {
        final String productId = call.getString("productId");
        if (productId == null) {
            call.reject("productId is required");
            return;
        }
        withConnection(new ConnectionCallback() {
            @Override
            public void onReady() {
                queryProduct(productId, new ProductCallback() {
                    @Override
                    public void onProduct(ProductDetails details) {
                        JSObject ret = new JSObject();
                        ret.put("productId", details.getProductId());
                        ret.put("title", details.getTitle());
                        ret.put("description", details.getDescription());
                        ProductDetails.OneTimePurchaseOfferDetails offer =
                                details.getOneTimePurchaseOfferDetails();
                        ret.put("price", offer != null ? offer.getFormattedPrice() : "");
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

    private interface ProductCallback {
        void onProduct(ProductDetails details);

        void onError(String message);
    }

    private void queryProduct(String productId, final ProductCallback callback) {
        QueryProductDetailsParams.Product product = QueryProductDetailsParams.Product.newBuilder()
                .setProductId(productId)
                .setProductType(BillingClient.ProductType.INAPP)
                .build();
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(product))
                .build();

        billingClient.queryProductDetailsAsync(params, (billingResult, productDetailsList) -> {
            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                callback.onError("Product query failed: " + billingResult.getDebugMessage());
                return;
            }
            if (productDetailsList == null || productDetailsList.isEmpty()) {
                // Almost always a configuration problem: the product id isn't
                // active in Play Console, or this build isn't signed with the
                // uploaded key / isn't on a test track.
                callback.onError("Product not found in Play Console: " + productId);
                return;
            }
            callback.onProduct(productDetailsList.get(0));
        });
    }

    /** options: { productId } -> resolved later from onPurchasesUpdated */
    @PluginMethod
    public void purchase(final PluginCall call) {
        final String productId = call.getString("productId");
        if (productId == null) {
            call.reject("productId is required");
            return;
        }
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
                queryProduct(productId, new ProductCallback() {
                    @Override
                    public void onProduct(ProductDetails details) {
                        BillingFlowParams.ProductDetailsParams productParams =
                                BillingFlowParams.ProductDetailsParams.newBuilder()
                                        .setProductDetails(details)
                                        .build();
                        BillingFlowParams flowParams = BillingFlowParams.newBuilder()
                                .setProductDetailsParamsList(
                                        Collections.singletonList(productParams))
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

        JSObject ret = new JSObject();
        ret.put("purchases", purchasesToArray(purchases));
        ret.put("userCancelled", false);
        call.resolve(ret);
    }

    /** -> { purchases: [...] } for everything Play currently attributes to this account. */
    @PluginMethod
    public void restore(final PluginCall call) {
        withConnection(new ConnectionCallback() {
            @Override
            public void onReady() {
                QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build();
                billingClient.queryPurchasesAsync(params, (billingResult, purchases) -> {
                    if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                        call.reject("Purchase query failed: " + billingResult.getDebugMessage());
                        return;
                    }
                    for (Purchase purchase : purchases) {
                        acknowledgeIfNeeded(purchase);
                    }
                    JSObject ret = new JSObject();
                    ret.put("purchases", purchasesToArray(purchases));
                    call.resolve(ret);
                });
            }

            @Override
            public void onError(String message) {
                call.reject(message);
            }
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

    private JSArray purchasesToArray(List<Purchase> purchases) {
        JSArray array = new JSArray();
        if (purchases == null) return array;
        for (Purchase purchase : purchases) {
            // A purchase can cover several products; the entitlement is keyed
            // by product id on the JS side, so emit one entry per product.
            for (String productId : purchase.getProducts()) {
                JSObject item = new JSObject();
                item.put("productId", productId);
                item.put("purchaseToken", purchase.getPurchaseToken());
                item.put("orderId", purchase.getOrderId());
                item.put("state", purchase.getPurchaseState());
                item.put("acknowledged", purchase.isAcknowledged());
                array.put(item);
            }
        }
        return array;
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
