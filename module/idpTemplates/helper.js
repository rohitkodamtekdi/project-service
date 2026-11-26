/**
 * name : helper.js
 * Description : Admin view and edit of IDP templates.
 * An IDP template is a pathway category; its pillars are child categories and its tasks are
 * project template tasks. Edits change only the template data, so IDPs that participants
 * already have (projects) keep their copied names; only new IDPs pick up the changes.
 */

const projectCategoriesQueries = require(DB_QUERY_BASE_PATH + '/projectCategories')
const projectTemplateTaskQueries = require(DB_QUERY_BASE_PATH + '/projectTemplateTask')

const CATEGORY_EDITABLE_FIELDS = ['name', 'description', 'status']
const TASK_EDITABLE_FIELDS = ['name', 'description']
const CATEGORY_SKIP_FIELDS = ['__v', 'evidences', 'translations']

const badRequest = (message) => ({ status: HTTP_STATUS_CODE.bad_request.status, message })

const assertAdmin = (userDetails) => {
	const roles = userDetails?.userInformation?.roles || []
	if (!roles.includes(CONSTANTS.common.ADMIN_ROLE)) {
		throw {
			status: HTTP_STATUS_CODE.forbidden.status,
			message: CONSTANTS.apiResponses.IDP_TEMPLATE_ADMIN_ONLY,
		}
	}
}

const getTenantAndOrg = (userDetails) => ({
	tenantId: userDetails.userInformation.tenantId,
	orgId: userDetails.userInformation.organizationId,
})

// Keeps only the allowed fields; trims strings and validates name and status
const pickEditableFields = (body = {}, allowedFields) => {
	const data = {}
	allowedFields.forEach((field) => {
		if (body[field] === undefined) return
		data[field] = typeof body[field] === 'string' ? body[field].trim() : body[field]
	})

	if (Object.keys(data).length === 0) {
		throw badRequest(CONSTANTS.apiResponses.IDP_TEMPLATE_NOTHING_TO_UPDATE)
	}
	if (data.name !== undefined && (typeof data.name !== 'string' || data.name === '')) {
		throw badRequest(CONSTANTS.apiResponses.IDP_TEMPLATE_NAME_REQUIRED)
	}
	if (data.description !== undefined && typeof data.description !== 'string') {
		throw badRequest(CONSTANTS.apiResponses.IDP_TEMPLATE_NOTHING_TO_UPDATE)
	}
	// CONSTANTS is a global set after controllers load, so read it at call time, not at file load
	const categoryStatuses = [CONSTANTS.common.ACTIVE_STATUS, CONSTANTS.common.INACTIVE]
	if (data.status !== undefined && !categoryStatuses.includes(data.status)) {
		throw badRequest(CONSTANTS.apiResponses.IDP_TEMPLATE_INVALID_STATUS)
	}
	return data
}

module.exports = class IdpTemplatesHelper {
	/**
	 * All categories of the caller's tenant and org, active and inactive (not deleted),
	 * so admin can still see and re-activate an inactive pathway or pillar.
	 * @method
	 * @name categories
	 * @param {Object} userDetails - logged in user details
	 * @returns {Object} categories list
	 */
	static async categories(userDetails) {
		assertAdmin(userDetails)
		const { tenantId, orgId } = getTenantAndOrg(userDetails)

		const categories = await projectCategoriesQueries.categoryDocuments(
			{
				tenantId,
				visibleToOrganizations: { $in: [orgId] },
				isDeleted: false,
			},
			'all',
			CATEGORY_SKIP_FIELDS
		)

		return {
			success: true,
			message: CONSTANTS.apiResponses.IDP_TEMPLATE_CATEGORIES_FETCHED,
			data: categories,
		}
	}

	/**
	 * Update name, description or status of a pathway or pillar category.
	 * @method
	 * @name updateCategory
	 * @param {String} categoryId - category _id
	 * @param {Object} body - fields to update
	 * @param {Object} userDetails - logged in user details
	 * @returns {Object} updated category
	 */
	static async updateCategory(categoryId, body, userDetails) {
		assertAdmin(userDetails)
		if (!UTILS.isValidMongoId(categoryId)) {
			throw badRequest(CONSTANTS.apiResponses.IDP_TEMPLATE_INVALID_ID)
		}

		const updateData = pickEditableFields(body, CATEGORY_EDITABLE_FIELDS)
		const { tenantId, orgId } = getTenantAndOrg(userDetails)
		const findQuery = {
			_id: categoryId,
			tenantId,
			visibleToOrganizations: { $in: [orgId] },
			isDeleted: false,
		}

		const existing = await projectCategoriesQueries.categoryDocuments(findQuery, ['_id'])
		if (!existing.length) {
			throw badRequest(CONSTANTS.apiResponses.CATEGORY_NOT_FOUND)
		}

		await projectCategoriesQueries.updateMany(
			{ _id: categoryId, tenantId },
			{ $set: { ...updateData, updatedBy: userDetails.userInformation.userId } }
		)

		const [updated] = await projectCategoriesQueries.categoryDocuments(findQuery, 'all', CATEGORY_SKIP_FIELDS)

		return {
			success: true,
			message: CONSTANTS.apiResponses.IDP_TEMPLATE_CATEGORY_UPDATED,
			data: updated,
		}
	}

	/**
	 * Update name or description of a project template task.
	 * @method
	 * @name updateTask
	 * @param {String} taskId - task _id
	 * @param {Object} body - fields to update
	 * @param {Object} userDetails - logged in user details
	 * @returns {Object} updated task
	 */
	static async updateTask(taskId, body, userDetails) {
		assertAdmin(userDetails)
		if (!UTILS.isValidMongoId(taskId)) {
			throw badRequest(CONSTANTS.apiResponses.IDP_TEMPLATE_INVALID_ID)
		}

		const updateData = pickEditableFields(body, TASK_EDITABLE_FIELDS)
		const { tenantId } = getTenantAndOrg(userDetails)

		const existing = await projectTemplateTaskQueries.taskDocuments({ _id: taskId, tenantId, isDeleted: false }, [
			'_id',
		])
		if (!existing.length) {
			throw badRequest(CONSTANTS.apiResponses.PROJECT_TEMPLATE_TASKS_NOT_FOUND)
		}

		const updated = await projectTemplateTaskQueries.findOneAndUpdate(
			{ _id: taskId, tenantId },
			{ $set: { ...updateData, updatedBy: userDetails.userInformation.userId } },
			{ new: true, projection: { _id: 1, externalId: 1, name: 1, description: 1, updatedAt: 1, updatedBy: 1 } }
		)

		return {
			success: true,
			message: CONSTANTS.apiResponses.IDP_TEMPLATE_TASK_UPDATED,
			data: updated,
		}
	}
}
