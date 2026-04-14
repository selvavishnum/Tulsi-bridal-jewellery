import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: { type: String, required: true },
    shortDescription: { type: String },
    price: { type: Number, required: true, min: 0 },
    rentalPrice: { type: Number, min: 0 },
    discountPrice: { type: Number, min: 0 },
    images: [{ type: String }],
    category: {
      type: String,
      required: true,
      enum: [
        'necklace', 'earrings', 'bangles', 'bracelet', 'ring',
        'maang-tikka', 'nose-ring', 'anklet', 'set', 'other',
      ],
    },
    material: {
      type: String,
      enum: ['gold', 'silver', 'gold-plated', 'silver-plated', 'kundan', 'meenakari', 'polki', 'other'],
    },
    weight: { type: Number },
    stock: { type: Number, default: 1, min: 0 },
    isAvailableForRent: { type: Boolean, default: false },
    rentalStock: { type: Number, default: 0, min: 0 },
    tags: [String],
    featured: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    ratings: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0 },
    },
    reviews: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        name: String,
        rating: { type: Number, min: 1, max: 5 },
        comment: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],
    sku: { type: String, unique: true },
  },
  { timestamps: true }
);

productSchema.index({ name: 'text', description: 'text', tags: 'text' });

export default mongoose.models.Product || mongoose.model('Product', productSchema);
