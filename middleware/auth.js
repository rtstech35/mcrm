const jwt = require("jsonwebtoken");
require("dotenv").config();

const JWT_SECRET = process.env.JWT_SECRET;

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token gerekli' });
  }

  jwt.verify(token, JWT_SECRET || "fallback_secret_key_change_in_production", (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Geçersiz token' });
    }
    // Güvenlik önlemi: Eğer permissions string ise, JSON.parse yap
    if (user && user.permissions && typeof user.permissions === 'string') {
        try {
            user.permissions = JSON.parse(user.permissions);
        } catch (e) {
            console.error('JWT permissions parse hatası:', e);
            user.permissions = {};
        }
    }
    req.user = user;
    next();
  });
};

const checkPermission = (requiredPermission) => {
  return (req, res, next) => {
    const permissions = req.user.permissions || {};

    if (permissions.all === true) {
      return next();
    }

    const [module, action] = requiredPermission.split('.');
    const userModulePermissions = permissions[module];

    if (action === 'read' && userModulePermissions && Array.isArray(userModulePermissions) && userModulePermissions.includes('read_own')) {
        return next();
    }

    if (userModulePermissions && (userModulePermissions === true || (Array.isArray(userModulePermissions) && userModulePermissions.includes(action)))) {
      return next();
    }

    return res.status(403).json({ 
      success: false, 
      error: 'Bu işlem için yetkiniz yok.' 
    });
  };
};

module.exports = { authenticateToken, checkPermission };