-- Trigger: trg_auto_upgrade_customer_tier
-- Automatically upgrades customer membership tier based on reward points

CREATE OR REPLACE FUNCTION public.fn_auto_upgrade_customer_tier()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.reward_points >= 5000 THEN
        NEW.membership_tier := 'DIAMOND';
    ELSIF NEW.reward_points >= 2000 THEN
        NEW.membership_tier := 'PLATINUM';
    ELSIF NEW.reward_points >= 1000 THEN
        NEW.membership_tier := 'GOLD';
    ELSIF NEW.reward_points >= 500 THEN
        NEW.membership_tier := 'SILVER';
    ELSE
        NEW.membership_tier := 'BRONZE';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_upgrade_customer_tier ON public.customers;
CREATE TRIGGER trg_auto_upgrade_customer_tier
BEFORE UPDATE OF reward_points ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.fn_auto_upgrade_customer_tier();
