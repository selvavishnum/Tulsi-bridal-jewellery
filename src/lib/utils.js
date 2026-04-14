export function formatPrice(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function generateSKU(category, id) {
  const prefix = category.substring(0, 3).toUpperCase();
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${id?.toString().slice(-4) || '0000'}`;
}

export function calculateRentalDays(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end - start);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export function getDiscountPercentage(originalPrice, discountPrice) {
  if (!discountPrice || discountPrice >= originalPrice) return 0;
  return Math.round(((originalPrice - discountPrice) / originalPrice) * 100);
}

export function paginateArray(array, page = 1, limit = 12) {
  const start = (page - 1) * limit;
  return {
    data: array.slice(start, start + limit),
    total: array.length,
    pages: Math.ceil(array.length / limit),
    page,
  };
}

export function apiResponse(data, message = 'Success', status = 200) {
  return Response.json({ success: true, message, data }, { status });
}

export function apiError(message = 'Internal Server Error', status = 500) {
  return Response.json({ success: false, message }, { status });
}
