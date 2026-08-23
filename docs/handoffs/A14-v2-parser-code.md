# PulseRank v2 — second-stage parser code

Paste the JavaScript below into the second-stage **Parser code** editor.
Leave the second-stage Interaction code unchanged.

```javascript
// Extract product name from h1
let product_name = $('h1').text_sane();

// Extract brand from product name
let brand = product_name ? product_name.split(' ')[0] : null;

// Extract beverage type from breadcrumb
let beverage_type = $('.post-item-cat a').text_sane();

// Extract serving size
let serving_size_element = $('#serving-size');
let serving_size = serving_size_element.attr('data-mls')
  ? serving_size_element.attr('data-mls').trim()
  : null;

// Extract the caffeine number, excluding nested serving-size text
let caffeine_element = $('.db-info-data').first();
let caffeine_text = caffeine_element
  .clone()
  .children()
  .remove()
  .end()
  .text_sane() || '';

let caffeine_match = caffeine_text.match(/(\d+(?:\.\d+)?)/);
let caffeine_mg_per_serving = caffeine_match
  ? +caffeine_match[1]
  : null;

let caffeine_unit = caffeine_element.children('span').first().text_sane() || 'mg';
let caffeine_raw_text = caffeine_match
  ? `${caffeine_match[1]} ${caffeine_unit}`.trim()
  : null;

// Extract caffeine per 100 ml
let caffeine_mg_per_100ml = null;

$('.main p').each(function() {
  let text = $(this).text();
  let match = text.match(/(\d+\.?\d*)\s*mg\s+for\s+every\s+100\s*ml/i);

  if (match) {
    caffeine_mg_per_100ml = +match[1];
  }
});

// Extract caffeine strength
let caffeine_strength_level = $('.db-strength-header').text_sane();

// Extract calories
let calories_kcal = null;

$('.db-card').each(function() {
  if ($(this).find('.db-title').text_sane() === 'Calories') {
    calories_kcal = +$(this).find('.db-info-data').text_sane() || null;
  }
});

// Extract sugar
let sugar_g = null;

$('.db-card').each(function() {
  if ($(this).find('.db-title').text_sane() === 'Sugar') {
    sugar_g = +$(this).find('.db-info-data').text_sane() || null;
  }
});

// Extract image URL
let image_url = $('.db-img img').attr('src');

if (image_url && !image_url.startsWith('http')) {
  image_url = new URL(image_url, location.href);
} else if (image_url) {
  image_url = new URL(image_url);
}

// Current product page URL
let product_page_url = new URL(location.href);

return {
  product_name,
  brand,
  beverage_type,
  serving_size,
  caffeine_mg_per_serving,
  caffeine_mg_per_100ml,
  caffeine_strength_level,
  calories_kcal,
  sugar_g,
  caffeine_raw_text,
  image_url,
  product_url: null,
  category: null,
  product_page_url
};
```

Do not save or preview until the code has been pasted.
