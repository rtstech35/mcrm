const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ message: 'Müşteriler endpoint' });
});

module.exports = router;