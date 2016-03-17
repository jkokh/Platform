<?php
/**
 * @module Awards
 */
/**
 * Adapter implementing Stripe support for Awards_Payments functions
 *
 * @class Awards_Payments_Stripe
 * @implements Awards_Payments
 */

class Awards_Payments_Stripe extends Awards_Payments implements iAwards_Payments
{
	/**
	 * @constructor
	 * @param {array} $options=array() Any initial options
	 * @param {string} $options.secret
	 * @param {string} $options.publishableKey
	 * @param {string} $options.token If provided, allows us to create a customer and charge them
 	 * @param {Users_User} [$options.user=Users::loggedInUser()] Allows us to set the user to charge
	 */
	function __construct($options = array())
	{
		if (!isset($options['user'])) {
			$options['user'] = Users::loggedInUser(true);
		}
		$this->options = array_merge(array(
			'secret' => Q_Config::expect('Awards', 'payments', 'stripe', 'secret'),
			'publishableKey' => Q_Config::expect('Awards', 'payments', 'stripe', 'publishableKey'),
		), $options);
	}
	
	/**
	 * Executes some API calls and obtains a customer id
	 * @method customerId
	 * @return {string} The customer id
	 */
	function customerId()
	{
		$options = $this->options;
	}
	
	/**
	 * Executes some API calls and obtains a payment profile id
	 * @method paymentProfileId
	 * @return {string} The payment profile id
	 */
	function paymentProfileId($customerId)
	{
		$options = $this->options;
	}
	
	/**
	 * Make a one-time charge using the payments processor
	 * @method charge
	 * @param {double} $amount specify the amount (optional cents after the decimal point)
	 * @param {string} [$currency='usd'] set the currency, which will affect the amount
	 * @param {string} [$description=null] description of the charge, to be sent to customer
	 * @param {string} [$metadata=null] any additional metadata to store with the charge
	 * @param {string} [$subscriptionStreamName=null] if the charge belongs to a subscription, this is the id (last part of subscription's stream name)
	 * @throws \Stripe\Error\Card
	 * @return {Awards_Charge} the saved database row corresponding to the charge
	 */
	function charge($amount, $currency = 'usd', $description = null, $metadata = null, $subscriptionStreamName = null)
	{
		$options = $this->options;
		Q_Valid::requireFields(array('secret', 'user'), $options, true);
		\Stripe\Stripe::setApiKey($options['secret']);
		$user = $options['user'];
		$c = new Awards_Customer();
		$c->userId = $user->id;
		$c->payments = 'stripe';
		if (!$c->retrieve()) {
			Q_Valid::requireFields(array('token'), $options, true);
			$customer = \Stripe\Customer::create(array(
				"source" => $options['token'],
				"description" => $options['user']->displayName()
			));
			$c->customerId = $customer->id;
			$c->save();
		}
		$params = array(
			"amount" => $amount * 100, // in cents
			"currency" => $currency,
			"customer" => $c->customerId
		);
		if (isset($description)) {
			$params['description'] = $description;
		}
		if (isset($metadata)) {
			$params['metadata'] = $metadata;
		}
		\Stripe\Charge::create($params); // can throw some exception
		$charge = new Awards_Charge();
		$charge->userId = $user->id;
		$charge->subscriptionPublisherId = Q::ifset($options, 'subscription', 'publisherId', '');
		$charge->subscriptionStreamName = Q::ifset($options, 'subscription', 'streamName', '');
		$charge->description = Q::ifset($options, 'description', '');
		$charge->attributes = "{}";
		$charge-save();
		return $charge;
	}
	
	function authToken($customerId = null)
	{
		if (!isset($customerId)) {
			$customerId = $this->customerId();
		}
		
		$options = $this->options;

		// Common Set Up for API Credentials
		$merchantAuthentication = new AnetAPI\MerchantAuthenticationType();
		$merchantAuthentication->setName($options['authname']);
		$merchantAuthentication->setTransactionKey($options['authkey']);
		$refId = 'ref' . time();

		$setting = new AnetAPI\SettingType();

		// 2do: fix domain name and path for iframe popup

		$setting->setSettingName("hostedProfileIFrameCommunicatorUrl");
		$setting->setSettingValue(Q_Html::themedUrl('plugins/Awards/authnet_iframe_communicator.html'));

		$setting->setSettingName("hostedProfilePageBorderVisible");
		$setting->setSettingValue("false");

		$frequest = new AnetAPI\GetHostedProfilePageRequest();
		$frequest->setMerchantAuthentication($merchantAuthentication);
		$frequest->setCustomerProfileId($customerId);
		$frequest->addToHostedProfileSettings($setting);

		$controller = new AnetController\GetHostedProfilePageController($frequest);
		$fresponse = $controller->executeWithApiResponse($options['server']);

		if (!isset($fresponse) or ($fresponse->getMessages()->getResultCode() != "Ok")) {
			$messages = $fresponse->getMessages()->getMessage();
			$message = reset($messages);
			throw new Awards_Exception_InvalidResponse(array(
				'response' => $message->getCode() . ' ' . $message->getText()
			));
		}
		return $fresponse->getToken();
	}
	
	public $options = array();

}