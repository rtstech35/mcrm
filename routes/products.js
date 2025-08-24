const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ message: 'Ürünler endpoint' });
});

module.exports = router;