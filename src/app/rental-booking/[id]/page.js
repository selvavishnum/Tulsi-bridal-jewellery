'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import Link from 'next/link';
import {
  FiCalendar, FiTruck, FiPackage, FiMapPin, FiPhone, FiUser, FiMail,
  FiArrowLeft, FiCheck, FiInfo,
} from 'react-icons/fi';
import { formatPrice } from '@/lib/utils';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

const DELIVERY_OPTIONS = [
  { id: 'self',     label: 'Self Pickup',        desc: 'Pick up from our store',       icon: FiMapPin,  charge: 0 },
  { id: 'delivery', label: 'Home Delivery',       desc: 'We deliver to your address',   icon: FiTruck,   charge: 99 },
  { id: 'courier',  label: 'Courier (Both ways)', desc: 'Delivery + Return pickup',     icon: FiPackage, charge: 199 },
];

const RETURN_OPTIONS = [
  { id: 'self',    label: 'Self Return',       desc: 'Drop off at our store' },
  { id: 'pickup',  label: 'Schedule Pickup',   desc: 'We arrange return pickup (₹99)' },
];

function today() {
  return new Date().toISOString().split('T')[0];
}
function minEnd(startDate) {
  if (!startDate) return today();
  const d = new Date(startDate);
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}
function calcDays(start, end) {
  if (!start || !end) return 0;
  return Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000));
}

export default function RentalBookingPage({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session } = useSession();

  const [product, setProduct] = useState(null);
  const [loadingProduct, setLoadingProduct] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [delivery, setDelivery] = useState('self');
  const [returnMethod, setReturnMethod] = useState('self');
  const [paymentMethod, setPaymentMethod] = useState('cod');
  const [form, setForm] = useState({
    name: '', phone: '', email: '', address: '', city: '', state: '', pincode: '',
  });

  useEffect(() => {
    if (session?.user) {
      setForm((f) => ({ ...f, name: session.user.name || '', email: session.user.email || '' }));
    }
  }, [session]);

  useEffect(() => {
    fetch(`/api/products/${id}`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setProduct(d.data); })
      .catch(() => toast.error('Failed to load product'))
      .finally(() => setLoadingProduct(false));
  }, [id]);

  const rentalDays = calcDays(startDate, endDate);
  const rentalCost = rentalDays * (product?.rentalPrice || 0);
  const securityDeposit = Math.round((product?.price || 0) * 0.3);
  const deliveryCharge = DELIVERY_OPTIONS.find((o) => o.id === delivery)?.charge || 0;
  const returnCharge = returnMethod === 'pickup' && delivery !== 'courier' ? 99 : 0;
  const total = rentalCost + securityDeposit + deliveryCharge + returnCharge;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!startDate || !endDate) { toast.error('Please select rental dates'); return; }
    if (rentalDays < 1) { toast.error('End date must be after start date'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/rentals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: id,
          rentalStartDate: startDate,
          rentalEndDate: endDate,
          rentalDays,
          delivery: {
            method: delivery,
            charge: deliveryCharge,
          },
          returnMethod: {
            method: returnMethod,
            charge: returnCharge,
          },
          customerDetails: { ...form },
          payment: { method: paymentMethod, status: 'pending' },
          guestEmail: !session ? form.email : undefined,
          total,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Rental booking confirmed!');
        router.push(`/rental-success?rentalNumber=${data.data.rentalNumber}&email=${encodeURIComponent(form.email)}`);
      } else {
        toast.error(data.message || 'Booking failed');
      }
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingProduct) {
    return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }
  if (!product) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-gray-400">Product not found</p></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-maroon-950 text-white py-8">
        <div className="max-w-5xl mx-auto px-4">
          <Link href="/rentals" className="inline-flex items-center gap-1.5 text-maroon-200 hover:text-white text-sm transition mb-3">
            <FiArrowLeft /> Back to Rentals
          </Link>
          <h1 className="font-serif text-2xl font-bold">Book Rental Jewellery</h1>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        <form onSubmit={handleSubmit}>
          <div className="grid lg:grid-cols-3 gap-6">

            {/* LEFT — booking form */}
            <div className="lg:col-span-2 space-y-5">

              {/* Product preview */}
              <div className="bg-white rounded-xl p-4 shadow-sm flex gap-4 items-center">
                <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                  {product.images?.[0] && <Image src={product.images[0]} alt={product.name} fill className="object-cover" />}
                </div>
                <div>
                  <p className="text-xs text-gold-600 uppercase tracking-wider capitalize">{product.category}</p>
                  <h2 className="font-bold text-gray-800">{product.name}</h2>
                  <p className="text-sm text-maroon-950 font-semibold">{formatPrice(product.rentalPrice)} / day</p>
                </div>
              </div>

              {/* Date selection */}
              <div className="bg-white rounded-xl p-5 shadow-sm">
                <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2"><FiCalendar className="text-gold-600" /> Rental Dates</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block font-medium">Start Date *</label>
                    <input
                      type="date"
                      required
                      min={today()}
                      value={startDate}
                      onChange={(e) => { setStartDate(e.target.value); if (endDate && e.target.value >= endDate) setEndDate(''); }}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block font-medium">End Date *</label>
                    <input
                      type="date"
                      required
                      min={minEnd(startDate)}
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500"
                    />
                  </div>
                </div>
                {rentalDays > 0 && (
                  <div className="mt-3 bg-gold-50 border border-gold-100 rounded-lg px-4 py-2.5 flex items-center gap-2 text-sm">
                    <FiCheck className="text-gold-600 flex-shrink-0" />
                    <span className="text-gray-700"><span className="font-bold text-maroon-950">{rentalDays} day{rentalDays > 1 ? 's' : ''}</span> rental — {formatPrice(rentalCost)}</span>
                  </div>
                )}
              </div>

              {/* Delivery option */}
              <div className="bg-white rounded-xl p-5 shadow-sm">
                <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2"><FiTruck className="text-gold-600" /> Delivery Option</h3>
                <div className="space-y-2.5">
                  {DELIVERY_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <label key={opt.id} className={`flex items-center gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition ${delivery === opt.id ? 'border-gold-500 bg-gold-50' : 'border-gray-200 hover:border-gray-300'}`}>
                        <input type="radio" name="delivery" checked={delivery === opt.id} onChange={() => setDelivery(opt.id)} className="accent-gold-600" />
                        <Icon className={`text-lg flex-shrink-0 ${delivery === opt.id ? 'text-gold-600' : 'text-gray-400'}`} />
                        <div className="flex-1">
                          <p className="font-semibold text-sm text-gray-800">{opt.label}</p>
                          <p className="text-xs text-gray-500">{opt.desc}</p>
                        </div>
                        <span className={`text-sm font-bold flex-shrink-0 ${opt.charge === 0 ? 'text-green-600' : 'text-gray-700'}`}>
                          {opt.charge === 0 ? 'FREE' : `+${formatPrice(opt.charge)}`}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Return option — only if not courier (courier includes return) */}
              {delivery !== 'courier' && (
                <div className="bg-white rounded-xl p-5 shadow-sm">
                  <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2"><FiPackage className="text-gold-600" /> Return Method</h3>
                  <div className="space-y-2.5">
                    {RETURN_OPTIONS.map((opt) => (
                      <label key={opt.id} className={`flex items-center gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition ${returnMethod === opt.id ? 'border-gold-500 bg-gold-50' : 'border-gray-200 hover:border-gray-300'}`}>
                        <input type="radio" name="return" checked={returnMethod === opt.id} onChange={() => setReturnMethod(opt.id)} className="accent-gold-600" />
                        <div className="flex-1">
                          <p className="font-semibold text-sm text-gray-800">{opt.label}</p>
                          <p className="text-xs text-gray-500">{opt.desc}</p>
                        </div>
                        {opt.id === 'pickup' && <span className="text-sm font-bold text-gray-700 flex-shrink-0">+₹99</span>}
                        {opt.id === 'self'   && <span className="text-sm font-bold text-green-600 flex-shrink-0">FREE</span>}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Customer details */}
              <div className="bg-white rounded-xl p-5 shadow-sm">
                <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2"><FiUser className="text-gold-600" /> Your Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: 'name',    label: 'Full Name *',    required: true,  type: 'text',  col: 2 },
                    { key: 'phone',   label: 'Phone *',        required: true,  type: 'tel',   col: 1 },
                    { key: 'email',   label: 'Email *',        required: true,  type: 'email', col: 1 },
                    { key: 'address', label: 'Address *',      required: true,  type: 'text',  col: 2 },
                    { key: 'city',    label: 'City *',         required: true,  type: 'text',  col: 1 },
                    { key: 'state',   label: 'State *',        required: true,  type: 'text',  col: 1 },
                    { key: 'pincode', label: 'Pincode *',      required: true,  type: 'text',  col: 1 },
                  ].map((f) => (
                    <div key={f.key} className={f.col === 2 ? 'col-span-2' : ''}>
                      <label className="text-xs text-gray-500 mb-1 block">{f.label}</label>
                      <input
                        required={f.required}
                        type={f.type}
                        value={form[f.key]}
                        onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Payment */}
              <div className="bg-white rounded-xl p-5 shadow-sm">
                <h3 className="font-bold text-gray-700 mb-4">Payment Method</h3>
                <div className="space-y-2.5">
                  {[
                    { id: 'cod',      label: 'Cash on Delivery', desc: 'Pay when you receive the jewellery' },
                    { id: 'online',   label: 'Pay Online',       desc: 'UPI, Cards, Net Banking' },
                  ].map((p) => (
                    <label key={p.id} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition ${paymentMethod === p.id ? 'border-gold-500 bg-gold-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <input type="radio" checked={paymentMethod === p.id} onChange={() => setPaymentMethod(p.id)} className="accent-gold-600" />
                      <div>
                        <p className="font-semibold text-sm text-gray-800">{p.label}</p>
                        <p className="text-xs text-gray-500">{p.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex items-start gap-2 text-xs text-gray-500 bg-blue-50 rounded-lg p-3">
                  <FiInfo className="flex-shrink-0 text-blue-400 mt-0.5" />
                  Security deposit of {formatPrice(securityDeposit)} is refunded in full upon safe return of the jewellery.
                </div>
              </div>
            </div>

            {/* RIGHT — summary */}
            <div>
              <div className="bg-white rounded-xl p-5 shadow-sm sticky top-24 space-y-3">
                <h3 className="font-bold text-gray-700">Booking Summary</h3>

                <div className="space-y-2 text-sm text-gray-600 border-b border-gray-100 pb-3">
                  {startDate && endDate && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">{rentalDays} day{rentalDays > 1 ? 's' : ''} rental</span>
                      <span className="font-semibold">{formatPrice(rentalCost)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-500">Security deposit</span>
                    <span className="font-semibold">{formatPrice(securityDeposit)}</span>
                  </div>
                  {deliveryCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Delivery</span>
                      <span className="font-semibold">+{formatPrice(deliveryCharge)}</span>
                    </div>
                  )}
                  {returnCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Return pickup</span>
                      <span className="font-semibold">+{formatPrice(returnCharge)}</span>
                    </div>
                  )}
                </div>

                <div className="flex justify-between font-bold text-gray-800 text-base">
                  <span>Total</span><span className="text-maroon-950">{formatPrice(total)}</span>
                </div>

                <p className="text-xs text-green-600 font-medium">
                  ✓ Security deposit refunded on safe return
                </p>

                <button
                  type="submit"
                  disabled={submitting || !startDate || !endDate}
                  className="w-full py-3 bg-maroon-950 text-white font-bold rounded-xl hover:bg-maroon-900 disabled:opacity-50 transition flex items-center justify-center gap-2"
                >
                  {submitting ? <><LoadingSpinner size="sm" /> Booking…</> : <><FiCalendar /> Confirm Booking</>}
                </button>

                <p className="text-xs text-center text-gray-400">
                  By booking you agree to our rental terms & conditions
                </p>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
