-- Bu script, "Satış Personeli" rolünün yetkilerini güncelleyerek
-- menülerin doğru görünmesini sağlar.

UPDATE roles
SET 
    permissions = '{
        "sales_dashboard": true,
        "sales_customers": true,
        "sales_orders": true,
        "sales_delivery_notes": true,
        "sales_appointments": true,
        "sales_new_visit": true,
        "sales_accounts": true,
        "sales_map": true,
        "customers": ["read_own", "create"],
        "orders": ["read_own", "create"],
        "products": ["read"],
        "appointments": ["read_own", "create"],
        "visits": ["create"]
    }'::jsonb
WHERE 
    id = 3 AND name = 'Satış Personeli';