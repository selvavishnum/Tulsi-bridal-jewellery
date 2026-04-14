import mongoose from 'mongoose';

const rentalSchema = new mongoose.Schema(
  {
    rentalNumber: { type: String, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    guestEmail: String,
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true },
    productImage: String,
    rentalStartDate: { type: Date, required: true },
    rentalEndDate: { type: Date, required: true },
    rentalDays: { type: Number, required: true },
    pricePerDay: { type: Number, required: true },
    securityDeposit: { type: Number, default: 0 },
    totalRentalCost: { type: Number, required: true },
    total: { type: Number, required: true },
    customerDetails: {
      fullName: { type: String, required: true },
      phone: { type: String, required: true },
      email: String,
      address: String,
      idProof: String,
    },
    payment: {
      method: { type: String, enum: ['razorpay', 'cod'], default: 'razorpay' },
      status: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
      razorpayOrderId: String,
      razorpayPaymentId: String,
      paidAt: Date,
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'active', 'returned', 'cancelled', 'overdue'],
      default: 'pending',
    },
    depositRefunded: { type: Boolean, default: false },
    depositRefundedAt: Date,
    notes: String,
    returnCondition: String,
    returnedAt: Date,
  },
  { timestamps: true }
);

rentalSchema.pre('save', function (next) {
  if (!this.rentalNumber) {
    this.rentalNumber = 'TBjr' + Date.now().toString().slice(-8);
  }
  next();
});

export default mongoose.models.Rental || mongoose.model('Rental', rentalSchema);
