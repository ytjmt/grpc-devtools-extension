import { clone, create, type MessageInitShape } from "@bufbuild/protobuf";
import {
  anyPack,
  anyUnpack,
  durationFromMs,
  timestampFromDate,
  type Value,
  type ValueSchema,
} from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import type { MoneySchema } from "../gen/common/v1/money_pb.js";
import {
  CatalogService,
  ProductSchema,
  Product_Color,
  Product_Variant_Size,
  ProductStatus,
  WatchInventoryResponseSchema,
  type Product,
} from "../gen/shop/v1/catalog_pb.js";
import { OutOfStockSchema, ValidationErrorSchema } from "../gen/shop/v1/errors_pb.js";
import { GiftWrapSchema, OrderSchema, OrderService, OrderState, type Order } from "../gen/shop/v1/order_pb.js";

// Fixed times keep responses (and recorded fixtures) stable across runs.
const T0 = new Date("2026-01-15T09:30:00Z");
const at = (minutes: number) => timestampFromDate(new Date(T0.getTime() + minutes * 60_000));

const money = (units: bigint, currencyCode = "JPY", nanos = 0): MessageInitShape<typeof MoneySchema> => ({
  currencyCode,
  units,
  nanos,
});

const audit = (revision: bigint) => ({ createTime: at(0), updateTime: at(90), creator: "users/merch-7", revision });

/** Category tree: Apparel > Tops > T-shirts, to exercise a recursive message. */
const apparel = {
  id: "apparel",
  displayName: "Apparel",
  children: [{ id: "tops", displayName: "Tops", children: [{ id: "tees", displayName: "T-shirts", children: [] }] }],
};

function seedProducts(): Map<string, Product> {
  const products = [
    // Uses nearly every field: maps of messages and scalars, nested repeated messages,
    // Struct, a wrapper, every scalar type, and the oneof.
    create(ProductSchema, {
      name: "products/tee-001",
      title: "Organic Cotton Tee",
      description: "Heavyweight 6.2oz tee, garment dyed.",
      status: ProductStatus.ACTIVE,
      price: money(3300n),
      regionalPrices: { JP: money(3300n), US: money(24n, "USD", 990_000_000) },
      attributes: { material: "organic cotton", fit: "relaxed" },
      variants: [
        { sku: "TEE-001-BLK-M", color: Product_Color.BLACK, size: Product_Variant_Size.M, stock: 12 },
        { sku: "TEE-001-WHT-L", color: Product_Color.WHITE, size: Product_Variant_Size.L, stock: 0, priceDelta: money(200n) },
        { sku: "TEE-001-IND-S", color: Product_Color.INDIGO, size: Product_Variant_Size.S, stock: 3, priceDelta: money(-300n) },
      ],
      tags: ["organic", "bestseller"],
      statusHistory: [ProductStatus.DRAFT, ProductStatus.ACTIVE],
      category: apparel,
      metadata: {
        season: "SS26",
        campaigns: ["spring-sale", "eco-week"],
        weightGrams: { s: 180, m: 200, l: 215 },
        limited: true,
        retired: null,
      },
      barcode: "4901234567894",
      stats: {
        rating: 4.6,
        popularity: 0.873,
        viewCount: 9007199254740993n,
        reviewCount: 128,
        rankDelta: -3,
        stockDelta: -120n,
        imageCrc: 0xdeadbeef,
        contentHash: 0xfeedfacecafebeefn,
        temperatureOffset: -2,
        ledgerBalance: -9007199254740993n,
        featured: true,
        thumbnail: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      },
      audit: audit(7n),
      availability: { case: "inStockQuantity", value: 15 },
      shortLabel: "Bestseller",
    }),
    // Optional description and barcode unset; availability is a timestamp; deprecated enum value.
    create(ProductSchema, {
      name: "products/mug-002",
      title: "Stoneware Mug",
      status: ProductStatus.DISCONTINUED,
      price: money(1800n),
      attributes: { capacity: "350ml" },
      tags: ["kitchen"],
      statusHistory: [ProductStatus.ACTIVE, ProductStatus.DISCONTINUED],
      category: { id: "kitchen", displayName: "Kitchen", children: [] },
      audit: audit(3n),
      availability: { case: "restockTime", value: at(60 * 24 * 14) },
    }),
    create(ProductSchema, {
      name: "products/poster-003",
      title: "Risograph Poster",
      status: ProductStatus.ACTIVE,
      price: money(4500n),
      audit: audit(1n),
      availability: { case: "madeToOrder", value: true },
      shortLabel: "Made to order",
    }),
  ];
  return new Map(products.map((p) => [p.name, p]));
}

// The demo never persists changes, so a scenario can be replayed with identical results
// (tests and recorded fixtures rely on that).
const products = seedProducts();

/** Keeps only the top-level fields named in a FieldMask (enough for the demo). */
function applyMask(product: Product, paths: string[]): Product {
  if (paths.length === 0) return product;
  const masked = create(ProductSchema, { name: product.name });
  for (const field of ProductSchema.fields) {
    if (!paths.includes(field.name)) continue;
    if (field.oneof) {
      // Oneof members live under the oneof's property as { case, value }.
      if (product.availability.case === field.localName) masked.availability = product.availability;
    } else {
      Object.assign(masked, { [field.localName]: product[field.localName as keyof Product] });
    }
  }
  return masked;
}

function findProduct(name: string): Product {
  const product = products.get(name);
  if (!product) throw new ConnectError(`${name} not found`, Code.NotFound);
  return product;
}

function findVariant(sku: string) {
  for (const p of products.values()) {
    const variant = p.variants.find((v) => v.sku === sku);
    if (variant) return { product: p, variant };
  }
  return undefined;
}

export function shopRoutes(router: ConnectRouter) {
  router.service(CatalogService, {
    getProduct(req) {
      return { product: applyMask(findProduct(req.name), req.readMask?.paths ?? []) };
    },

    listProducts(req) {
      const pageSize = req.page?.pageSize || 10;
      const offset = Number(req.page?.pageToken || 0);
      const matches = [...products.values()].filter(
        (p) =>
          (req.statuses.length === 0 || req.statuses.includes(p.status)) &&
          p.title.toLowerCase().includes(req.query.toLowerCase()) &&
          (!req.maxPrice || (p.price?.units ?? 0n) <= req.maxPrice.units),
      );
      const page = matches.slice(offset, offset + pageSize);
      const next = offset + pageSize < matches.length ? String(offset + pageSize) : "";
      return { products: page, page: { nextPageToken: next, totalSize: BigInt(matches.length) } };
    },

    updateProduct(req) {
      const current = clone(ProductSchema, findProduct(req.product?.name ?? ""));
      if (req.expectedRevision !== undefined && req.expectedRevision !== current.audit?.revision) {
        throw new ConnectError(
          `revision is ${current.audit?.revision}, expected ${req.expectedRevision}`,
          Code.Aborted,
        );
      }
      for (const path of req.updateMask?.paths ?? []) {
        const field = ProductSchema.fields.find((f) => f.name === path);
        if (!field) throw new ConnectError(`unknown field in update_mask: ${path}`, Code.InvalidArgument);
        Object.assign(current, { [field.localName]: req.product![field.localName as keyof Product] });
      }
      if (current.audit) {
        current.audit.revision += 1n;
        current.audit.updateTime = at(120);
      }
      return { product: current };
    },

    deleteProduct(req) {
      findProduct(req.name); // validates the name; nothing is actually deleted
      return {};
    },

    async *watchInventory(req) {
      const pause = Math.min(Number(req.interval?.nanos ?? 0) / 1e6 + Number(req.interval?.seconds ?? 0n) * 1000, 300);
      const sku = req.skus[0] ?? "TEE-001-BLK-M";
      const events: MessageInitShape<typeof WatchInventoryResponseSchema>[] = [
        { eventTime: at(1), event: { case: "stockChanged", value: { sku, stock: 11 } } },
        {
          eventTime: at(2),
          event: { case: "priceChanged", value: { sku, oldPrice: money(3300n), newPrice: money(2970n) } },
        },
        { eventTime: at(3), event: { case: "stockChanged", value: { sku, stock: 10 } } },
        { eventTime: at(4), event: { case: "archivedProduct", value: "products/mug-002" } },
      ];
      for (const event of events) {
        await new Promise((r) => setTimeout(r, pause));
        yield event;
      }
    },
  });

  router.service(OrderService, {
    createOrder(req) {
      // Validation errors carry a ValidationError detail listing every problem.
      const violations = [
        ...(req.items.length === 0 ? [{ field: "items", description: "at least one item is required" }] : []),
        ...req.items.flatMap((item, i) => [
          ...(item.quantity <= 0 ? [{ field: `items[${i}].quantity`, description: "must be positive" }] : []),
          ...(!findVariant(item.sku) ? [{ field: `items[${i}].sku`, description: `unknown SKU ${item.sku}` }] : []),
        ]),
        ...(!req.shippingAddress ? [{ field: "shipping_address", description: "is required" }] : []),
      ];
      if (violations.length) {
        throw new ConnectError("order is invalid", Code.InvalidArgument, undefined, [
          { desc: ValidationErrorSchema, value: { violations } },
        ]);
      }
      for (const item of req.items) {
        const { variant } = findVariant(item.sku)!;
        if (variant.stock < item.quantity) {
          throw new ConnectError(`not enough stock for ${item.sku}`, Code.FailedPrecondition, undefined, [
            { desc: OutOfStockSchema, value: { sku: item.sku, requested: item.quantity, available: variant.stock } },
          ]);
        }
      }

      const items = req.items.map((item) => {
        const { product, variant } = findVariant(item.sku)!;
        const unit = (product.price?.units ?? 0n) + (variant.priceDelta?.units ?? 0n);
        return { sku: item.sku, quantity: item.quantity, unitPrice: money(unit) };
      });
      const total = items.reduce((sum, i) => sum + (i.unitPrice.units ?? 0n) * BigInt(i.quantity), 0n);
      const order = create(OrderSchema, {
        name: "orders/1001",
        items,
        total: money(total),
        shippingAddress: req.shippingAddress,
        state: OrderState.PAID,
        payment: req.payment.case ? (req.payment as Order["payment"]) : { case: "cashOnDelivery", value: {} },
        deliveryEstimate: durationFromMs(2 * 24 * 60 * 60 * 1000),
        labels: labels({ channel: "web", priority: 2, giftable: true, coupons: ["SPRING10"] }),
        // Echo known extensions back; drop unknown ones.
        extensions: req.extensions.filter((e) => anyUnpack(e, GiftWrapSchema)),
        audit: audit(1n),
      });
      return { order };
    },

    getOrder(req) {
      return { order: sampleOrder(req.name) };
    },

    async *trackOrder(req) {
      const steps: [OrderState, string][] = [
        [OrderState.PAID, "Payment confirmed"],
        [OrderState.SHIPPED, "Tokyo hub"],
        [OrderState.DELIVERED, "Delivered to recipient"],
      ];
      for (const [i, [state, facility]] of steps.entries()) {
        await new Promise((r) => setTimeout(r, 200));
        yield {
          state,
          eventTime: at(60 * (i + 1)),
          location: { facility, lat: 35.6812 + i / 100, lng: 139.7671, order: req.name },
        };
      }
    },

    async uploadReceipts(requests) {
      let received = 0;
      let totalBytes = 0n;
      for await (const r of requests) {
        received++;
        totalBytes += BigInt(r.image.length);
      }
      return { received, totalBytes };
    },

    async *chatWithSupport(requests) {
      for await (const r of requests) {
        yield { agent: "Aiko", text: `Re: ${r.text}`, sendTime: timestampFromDate(new Date()) };
      }
    },
  });
}

/** Builds map<string, google.protobuf.Value> from plain JSON-ish values. */
type Json = string | number | boolean | string[];

function labels(values: Record<string, Json>): Record<string, Value> {
  const toValue = (v: Json): MessageInitShape<typeof ValueSchema> =>
    typeof v === "string"
      ? { kind: { case: "stringValue", value: v } }
      : typeof v === "number"
        ? { kind: { case: "numberValue", value: v } }
        : typeof v === "boolean"
          ? { kind: { case: "boolValue", value: v } }
          : { kind: { case: "listValue", value: { values: v.map(toValue) } } };
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, toValue(v) as Value]));
}

function sampleOrder(name: string): Order {
  return create(OrderSchema, {
    name,
    items: [{ sku: "TEE-001-BLK-M", quantity: 2, unitPrice: money(3300n) }],
    total: money(6600n),
    shippingAddress: {
      regionCode: "JP",
      postalCode: "150-0001",
      administrativeArea: "Tokyo",
      locality: "Shibuya-ku",
      addressLines: ["Jingumae 1-2-3", "Room 405"],
      recipients: ["Hanako Yamada"],
    },
    state: OrderState.SHIPPED,
    payment: { case: "bankTransfer", value: { bankCode: "0001", dueTime: at(60 * 24 * 3) } },
    deliveryEstimate: durationFromMs(36 * 60 * 60 * 1000),
    labels: labels({ channel: "app", priority: 1 }),
    extensions: [anyPack(GiftWrapSchema, create(GiftWrapSchema, { paper: "kraft", message: "Happy birthday!" }))],
    audit: audit(4n),
  });
}
